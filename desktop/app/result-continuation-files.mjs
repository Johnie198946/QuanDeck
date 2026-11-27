import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { matchesStoredFile } from "./task-attachments.mjs";
import { readDeliveryFile, validateDeliveryBytes } from "./delivery-file-verifier.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const safeId = (id) => typeof id === "string" && /^[\w-]{1,160}$/.test(id);
const stale = () => Error("成果版本或文件已变化，请重新选择成果并核对文件清单");

function relativeFile(value) {
  if (
    typeof value !== "string" ||
    !value ||
    /^(?:#|https?:|mailto:)/i.test(value) ||
    value.endsWith("/")
  )
    return;
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw Error("成果中的文件链接无法读取");
  }
  const relative = decoded.replace(/^(?:\.\/)+/, "");
  if (
    /^[\w+.-]+:|^\/|[\\\x00-\x1f]/.test(relative) ||
    relative.split("/").some((part) => !part || part.startsWith("."))
  )
    throw Error("成果文件只支持来源任务目录内的相对链接");
  return relative;
}

function references(artifact) {
  const registered = (artifact.attachments ?? []).map((file) => ({ file }));
  const frozenPaths = new Set(
    registered.map((ref) => ref.file.projectRelativePath).filter(Boolean),
  );
  const markdown = artifact.body
    .replace(
      /^`{3,}[^\n]*\n[\s\S]*?(?:^`{3,}[^\n]*$|(?![\s\S]))|^~{3,}[^\n]*\n[\s\S]*?(?:^~{3,}[^\n]*$|(?![\s\S]))/gm,
      "",
    )
    .replace(/`+[^\n`]*?`+/g, "");
  const links = [
    ...markdown.matchAll(
      /!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g,
    ),
  ].map((match) => match[1] ?? match[2]);
  const paths = new Set();
  for (const link of [...links, ...(artifact.links ?? []).map((link) => link.url)]) {
    if (link.startsWith("attachment:")) {
      if (!registered.some((ref) => ref.file.id === link.slice("attachment:".length)))
        throw Error("成果引用的附件没有登记在当前版本");
      continue;
    }
    const relative = relativeFile(link);
    if (!relative || frozenPaths.has(relative)) continue;
    if (
      !relative.includes("/") &&
      registered.filter((ref) => ref.file.name === relative).length === 1
    )
      continue;
    paths.add(relative);
  }
  return [...registered, ...[...paths].map((relative) => ({ relative }))];
}

export function createResultContinuationFiles({ snapshot, findSource, readRun, store }) {
  async function bind(projectId, artifactId, hash) {
    if (
      !safeId(projectId) ||
      !safeId(artifactId) ||
      typeof hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(hash)
    )
      throw stale();
    const project = await snapshot(projectId);
    if (project?.project.id !== projectId || project.project.deletedAt) throw stale();
    const source = findSource(project, artifactId);
    if (!source) throw stale();
    const artifact = project.collaboration?.artifacts.find(
      (a) => a.id === artifactId && a.hash === hash,
    );
    if (!artifact) throw stale();
    return { project, artifact, historical: source.historical === true };
  }

  async function sourceRoot(project, artifact) {
    const task = project.collaboration.tasks[artifact.key];
    const session = Object.values(project.sessions ?? {}).find(
      (s) => s.runtime?.collaboration?.runId === artifact.runId,
    );
    const rt = session?.runtime;
    if (!artifact.runId || !task || !rt?.runId) throw Error("找不到这份成果的原执行目录");
    const run = await readRun(rt.runId);
    if (
      !run?.projectPath ||
      run.runId !== rt.runId ||
      run.collaboration?.runId !== artifact.runId ||
      run.projectId !== project.project.id ||
      run.taskId !== task.taskId ||
      run.workItemId !== task.workItemId
    )
      throw Error("成果的执行目录与来源任务不一致");
    const origin = await lstat(run.projectPath);
    if (!origin.isDirectory() || origin.isSymbolicLink())
      throw Error("原执行目录已替换，请重新确认来源");
    return realpath(run.projectPath);
  }

  async function read(ref, root, project, artifact) {
    if (ref.file) {
      const file = ref.file;
      if (
        !safeId(file.id) ||
        typeof file.name !== "string" ||
        path.basename(file.name) !== file.name ||
        /[\\\x00-\x1f]/.test(file.name) ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        file.size > 25 * 1024 * 1024
      )
        throw Error("成果附件记录无效");
      const bytes = Buffer.from(await store.attachment(project.project.id, file.id));
      const receipt = artifact.deliveryReceipts?.find(
        (r) => r.kind === "file" && r.attachmentId === file.id,
      );
      const sha256 = digest(bytes);
      if (
        file.size !== bytes.length ||
        (file.sha256 && file.sha256 !== sha256) ||
        (receipt && (receipt.contentHash !== sha256 || receipt.bytes !== bytes.length)) ||
        !matchesStoredFile(file, bytes)
      )
        throw stale();
      return { name: file.name, type: file.type || "application/octet-stream", sha256, bytes };
    }
    let local;
    try {
      local = await readDeliveryFile(root, ref.relative);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR")
        throw Error("找不到成果文件：" + ref.relative);
      throw error;
    }
    if (local.relative !== ref.relative) throw Error("成果文件链接已重定向，请在原任务重新确认");
    // Historical Markdown has no submission-time checksum. A later edit cannot be attributed to this version.
    if (
      !Number.isFinite(Date.parse(artifact.createdAt)) ||
      Math.floor(local.mtimeMs) > Date.parse(artifact.createdAt)
    )
      throw stale();
    const ext = path.extname(local.name).slice(1).toLowerCase();
    const type = validateDeliveryBytes(local.bytes, ext);
    return { name: local.name, type, sha256: digest(local.bytes), bytes: local.bytes };
  }

  async function inspect(projectId, artifactId, hash) {
    const { project, artifact, historical } = await bind(projectId, artifactId, hash);
    const refs = references(artifact);
    if (
      historical &&
      refs.some(
        ({ file }) =>
          !file ||
          !(
            /^[a-f0-9]{64}$/.test(file.sha256 ?? "") ||
            /^delivery-[a-f0-9]{64}$/.test(file.id) ||
            artifact.deliveryReceipts?.some(
              (r) =>
                r.kind === "file" &&
                r.attachmentId === file.id &&
                /^[a-f0-9]{64}$/.test(r.contentHash),
            )
          ),
      )
    )
      throw Error("旧版文件没有可核对的副本，请选择已有固定附件的成果版本");
    const root = refs.some((ref) => ref.relative) ? await sourceRoot(project, artifact) : undefined;
    const entries = [];
    for (const ref of refs) {
      const file = await read(ref, root, project, artifact);
      if (
        entries.some(
          (entry) =>
            entry.name === file.name && entry.type === file.type && entry.sha256 === file.sha256,
        )
      )
        continue;
      entries.push({
        ref,
        name: file.name,
        type: file.type,
        size: file.bytes.length,
        sha256: file.sha256,
      });
      if (entries.length > 20) throw Error("这份成果超过单个任务的 20 个附件上限");
    }
    const fingerprint = digest(JSON.stringify([projectId, artifactId, hash, entries]));
    return { project, artifact, root, entries, fingerprint, historical };
  }
  return {
    async preview(projectId, artifactId, hash) {
      const { entries, fingerprint } = await inspect(projectId, artifactId, hash);
      return {
        fingerprint,
        files: entries.map(({ name, size, sha256 }) => ({ name, size, sha256 })),
      };
    },
    async freeze(projectId, artifactId, hash, expected) {
      const { project, artifact, root, entries, fingerprint, historical } = await inspect(
        projectId,
        artifactId,
        hash,
      );
      if (fingerprint !== expected) throw stale();
      const files = [];
      for (const entry of entries) {
        const { name, type, sha256, bytes } = await read(entry.ref, root, project, artifact);
        if (entry.sha256 !== sha256) throw stale();
        files.push(
          await store.saveAttachment(projectId, { name, type, bytes, contentAddressed: true }),
        );
      }
      if ((await bind(projectId, artifactId, hash)).historical !== historical) throw stale();
      return files;
    },
  };
}
