import path from 'node:path';
import { realpath, open, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const maximum = 300000;
const inside = (root, target) => target !== root && target.startsWith(root + path.sep);
const textFile = value => /\.(md|txt)$/i.test(value);
function decodeText(bytes) {
  if (!bytes.length || bytes.length > maximum) throw new Error('规范附件须为 1–300000 字节的文本文件');
  let body;
  try { body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('规范附件不是有效 UTF-8；请先另存为 UTF-8 后重新导入'); }
  if (!body.trim() || body.includes('\0') || body.length > 100000) throw new Error('规范正文为空、含无效字符或超过 100000 字符');
  return { body, size: bytes.length, fileHash: createHash('sha256').update(bytes).digest('hex') };
}
async function localTarget(root, value) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f]/.test(value) || /^(?:https?:|data:|javascript:|\/\/|\\\\)/i.test(value)) throw new Error('规范附件只支持项目内本地文件');
  let input = value;
  if (/^file:/i.test(value)) {
    try { const url = new URL(value); if (url.hostname && url.hostname !== 'localhost') throw Error(); input = fileURLToPath(url); }
    catch { throw new Error('规范附件文件链接无效'); }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) throw new Error('规范附件不支持网络地址');
  const absolute = value => path.isAbsolute(value) ? value : path.resolve(root, value);
  try { return await realpath(absolute(input)); }
  catch (error) {
    if (error.code !== 'ENOENT' || !/%[\da-f]{2}/i.test(input) || /^file:/i.test(value)) throw error;
    const decoded = decodeURIComponent(input);
    if (/[\x00-\x1f]/.test(decoded)) throw new Error('规范附件路径无效');
    return realpath(absolute(decoded));
  }
}

/** All identities come from accepted ledger artifacts; callers send IDs, never paths or bytes. */
export function createSpecAttachmentImporter({ snapshot, readRun, attachment, candidates, record, mutate }) {
  return async function importText(projectId, artifactId, candidateId) {
    if (![projectId, artifactId, candidateId].every(value => typeof value === 'string' && value && value.length < 300)) throw new Error('规范附件请求无效');
    const project = await snapshot(projectId);
    if (!project || project.project?.id !== projectId || project.project.deletedAt) throw new Error('项目不存在');
    const candidate = candidates(project, artifactId).find(value => value.id === candidateId);
    if (!candidate || candidate.artifactId !== artifactId) throw new Error('附件不属于当前已验收成果');
    let content;
    if (candidate.kind === 'output') {
      if (!candidate.attachmentId || !candidate.outputId || !textFile(candidate.name) || candidate.size > maximum) throw new Error('仅支持已登记的 .md/.txt 小型文本附件');
      const bytes = Buffer.from(await attachment(projectId, candidate.attachmentId));
      if (bytes.length !== candidate.size) throw new Error('附件内容与已登记大小不一致');
      content = decodeText(bytes);
    } else if (candidate.kind === 'local') {
      if (!candidate.runtimeRunId) throw new Error('附件缺少来源执行绑定');
      const run = await readRun(candidate.runtimeRunId);
      const artifact = project.collaboration?.artifacts.find(value => value.id === artifactId);
      const task = artifact && project.collaboration.tasks[artifact.key];
      if (!run?.projectPath || run.projectId !== projectId || run.taskId !== task?.taskId || (run.workItemId ?? undefined) !== (task?.workItemId ?? undefined)) throw new Error('附件来源会话与项目任务不匹配');
      const root = await realpath(run.projectPath), target = await localTarget(root, candidate.path);
      if (!inside(root, target)) throw new Error('只能导入当前项目内的规范文件');
      if (!textFile(target)) throw new Error('规范导入仅支持 .md/.txt 文件');
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.size < 1 || before.size > maximum) throw new Error('规范附件须为不超过 300000 字节的普通文件');
        const buffer = Buffer.alloc(before.size + 1); let length = 0;
        while (length < buffer.length) { const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length); if (!bytesRead) break; length += bytesRead; }
        const after = await handle.stat(), resolved = await realpath(target), current = await stat(target);
        if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || resolved !== target || !inside(root, resolved) || current.ino !== before.ino || current.dev !== before.dev) throw new Error('规范附件读取期间发生变化，请重试');
        content = { ...decodeText(buffer.subarray(0, length)), path: path.relative(root, target).split(path.sep).join('/') };
      } finally { await handle.close(); }
    } else throw new Error('规范附件类型无效');
    let result;
    // Revalidate acceptance and file identity atomically after asynchronous I/O.
    await mutate(projectId, current => { result = record(current, candidate, content); });
    return result;
  };
}
