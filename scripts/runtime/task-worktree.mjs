import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const git = async (cwd, ...args) =>
  (
    await exec("git", ["--no-optional-locks", "-C", cwd, ...args], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 45000,
      maxBuffer: 8 * 1024 * 1024,
    })
  ).stdout.trimEnd();
const exists = (file) =>
  lstat(file).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
export const sameGitPath = (left, right, platform = process.platform) =>
  platform === "win32"
    ? path.win32.resolve(left).toLowerCase() === path.win32.resolve(right).toLowerCase()
    : path.resolve(left) === path.resolve(right);
const sha = /^[\da-f]{40}(?:[\da-f]{24})?$/u;

export function codingRole(input) {
  if (input.purpose !== "execution" || !input.projectId || !input.taskId) return;
  const title = (input.title ?? "").trim();
  if (/^(?:代码任务|编码任务|code task)\s*[:：]/iu.test(title)) return "code";
  if (/^(?:集成发布任务|发布任务|release task)\s*[:：]/iu.test(title)) return "release";
  // Task titles can be vague. In a Git project conservatively isolate every managed
  // execution unless its own declared scope is explicitly read-only.
  if (
    /^(?:请(?:帮我)?|帮我)?(?:只读|仅(?:研讨|讨论|解释|咨询|分析)|只(?:研讨|讨论|解释|咨询|分析)|研讨|讨论|解释|咨询|read[- ]only\b|explain\b)/iu.test(
      title,
    ) &&
    !/(?:然后|并且|同时|再|随后|and then)\s*(?:修改|实现|写入|编辑|开发|implement|edit|write)/iu.test(
      title,
    )
  )
    return;
  if (
    /^(?:请(?:帮我)?|帮我)?(?:集成发布|整合发布|合并并发布|发布(?:软件|应用|新版本|版本)|release\s+v?\d)/iu.test(
      title,
    )
  )
    return "release";
  return "code";
}

async function requireCleanSource(source) {
  // Attachment preparation materializes read-only task inputs before admission.
  // Ignore only these untracked staging files, never tracked edits there.
  const staged = await git(source, "status", "--porcelain=v1", "-uno");
  const extras = await git(
    source,
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ".",
    ":(exclude).quandeck/attachments/**",
  );
  if (staged || extras)
    throw Error(
      "项目目录有未提交的修改。请先保存为本地提交，或将项目连接到干净的工作树，再派发编码任务。",
    );
}

function workspaceIdentity(source, input) {
  const key = createHash("sha256")
    .update(JSON.stringify([source, input.projectId, input.taskId, input.workItemId ?? ""]))
    .digest("hex")
    .slice(0, 32);
  const directory = path.join(path.dirname(source), ".quandeck-worktrees", key);
  return { directory, branch: "codex/quandeck-" + key, baseRef: "refs/quandeck/task-bases/" + key };
}

async function verifyBinding(source, input, record) {
  const { directory, branch, baseRef } = workspaceIdentity(source, input);
  if (
    !sameGitPath(record.source, source) ||
    !sameGitPath(record.directory, directory) ||
    record.branch !== branch ||
    !sha.test(record.baseSha) ||
    !["code", "release"].includes(record.role)
  )
    throw Error("任务工作树记录与当前项目不一致，请核对任务目录。");
  if (
    !sameGitPath(await realpath(directory), directory) ||
    !sameGitPath(await git(directory, "rev-parse", "--show-toplevel"), directory) ||
    (await git(directory, "symbolic-ref", "--quiet", "--short", "HEAD")) !== branch ||
    (await git(source, "rev-parse", baseRef)) !== record.baseSha ||
    !sameGitPath(
      await git(directory, "rev-parse", "--path-format=absolute", "--git-common-dir"),
      await git(source, "rev-parse", "--path-format=absolute", "--git-common-dir"),
    )
  ) {
    throw Error("任务工作树或分支已移动，请恢复原任务目录后重试。");
  }
  await git(directory, "merge-base", "--is-ancestor", record.baseSha, "HEAD");
  return record;
}

export async function prepareTaskWorktree(projectPath, input, previous) {
  const role = previous?.role ?? codingRole(input);
  if (!role) return;
  // Nested project directories must never implicitly authorize access to their parent repository.
  if (!previous && !(await exists(path.join(projectPath, ".git")))) return;
  const source = await realpath(projectPath);
  if (previous) return verifyBinding(source, input, previous);
  const { directory, branch, baseRef } = workspaceIdentity(source, input);
  const parent = path.dirname(directory);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  if (!sameGitPath(await realpath(parent), parent))
    throw Error("任务目录包含不受支持的路径链接，请核对工作目录。");
  const stored = await git(source, "rev-parse", "--verify", "--quiet", baseRef).catch((error) => {
    if (error.code !== 1) throw error;
  });
  if (stored && (await exists(directory)))
    return verifyBinding(source, input, { role, source, directory, branch, baseSha: stored });
  if (await exists(directory))
    throw Error("任务目录已存在且没有匹配的基线记录，保留现场；请检查任务工作树。");
  await requireCleanSource(source);
  const baseSha = await git(source, "rev-parse", "--verify", "HEAD^{commit}").catch(() => {
    throw Error("项目还没有可复现的 Git 提交，请先保存项目基线。");
  });
  if (stored && stored !== baseSha)
    throw Error("任务工作树缺失且项目基线已更新，请恢复原工作树或创建新任务。");
  if (
    await git(source, "show-ref", "--verify", "--quiet", "refs/heads/" + branch).then(
      () => true,
      (error) => {
        if (error.code === 1) return false;
        throw error;
      },
    )
  )
    throw Error("已有同名任务分支但工作树记录不完整，请检查并保留现有变更。");
  if (!stored) await git(source, "update-ref", baseRef, baseSha, "0".repeat(baseSha.length));
  // An existing branch is never reset/replaced, even after interruption or manual removal.
  await git(source, "worktree", "add", "-b", branch, directory, baseSha);
  return verifyBinding(source, input, { role, source, directory, branch, baseSha });
}

export function taskWorktreeInstructions(record) {
  return [
    "此任务在专属 Git 工作树中执行。目录 " +
      record.directory +
      "，分支 " +
      record.branch +
      "，起点 " +
      record.baseSha +
      "。",
    record.role === "release"
      ? "按已授权的发布范围整合，先核对当前基线、变更和版本，再构建。"
      : "交付任务分支的变更和验证结果。产品版本号由集成发布环节统一分配；请保留原项目、主分支、标签和远端。",
    "工作树会保留，重试或交接继续使用同一目录。请在回报中写明任务分支、变更文件和验证情况。",
  ].join("\n");
}

export async function verifyTaskWorktree(projectPath, input, record) {
  await verifyBinding(await realpath(projectPath), input, record);
  const latest = await git(record.source, "rev-parse", "HEAD");
  if (record.role === "release") {
    await requireCleanSource(record.source);
    await git(record.directory, "merge-base", "--is-ancestor", latest, "HEAD").catch(() => {
      throw Error("项目基线已前进。请先将最新提交整合进发布分支并重新验证。");
    });
  }
  // The task may already include a later release from the project. Only changes after
  // the shared ancestor belong to this task. A release also cannot downgrade a stable version.
  const shared = await git(record.directory, "merge-base", latest, "HEAD");
  const files = await git(
    record.directory,
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    shared,
    "--",
    "package.json",
    ":(glob)**/package.json",
    "package-lock.json",
    ":(glob)**/package-lock.json",
  );
  for (const file of files.split("\0").filter(Boolean)) {
    const original = await git(record.directory, "show", shared + ":" + file).catch((error) => {
      if (error.code !== 128) throw error;
    });
    if (!original) continue;
    const target = path.join(record.directory, file),
      info = await exists(target);
    if (!info) continue;
    if (!info.isFile() || info.isSymbolicLink() || !sameGitPath(await realpath(target), target))
      throw Error("版本清单路径已变化，请检查 " + file);
    const before = JSON.parse(original),
      after = JSON.parse(await readFile(target, "utf8"));
    const versions = [[before.version, after.version]];
    if (path.basename(file) === "package-lock.json") {
      versions.push([before.packages?.[""]?.version, after.packages?.[""]?.version]);
    }
    for (const [prior, candidate] of versions) {
      if (prior === candidate) continue;
      if (record.role !== "release")
        throw Error(
          "编码任务修改了 " + file + " 的版本号。请保留功能改动，将发版号交给集成发布任务。",
        );
      if (
        typeof prior === "string" &&
        /^\d+\.\d+\.\d+$/.test(prior) &&
        typeof candidate === "string" &&
        /^\d+\.\d+\.\d+$/.test(candidate)
      ) {
        const previousParts = prior.split(".").map(BigInt),
          nextParts = candidate.split(".").map(BigInt);
        const different = nextParts.findIndex((part, i) => part !== previousParts[i]);
        if (different >= 0 && nextParts[different] < previousParts[different])
          throw Error(
            file + " 的候选版本 " + candidate + " 早于当前基线 " + prior + "，请核对正式版本号。",
          );
      }
    }
  }
}
