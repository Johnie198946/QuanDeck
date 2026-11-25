import { lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const imageTypes = /^image\/(png|jpeg|gif|webp)$/;
const day = 24 * 60 * 60 * 1000;

async function prepareShareDirectory(staging) {
  await mkdir(staging, { recursive: true, mode: 0o700 });
  const directory = await lstat(staging);
  if (!directory.isDirectory() || (process.getuid &&
      ((directory.mode & 0o077) || directory.uid !== process.getuid()))) throw new Error('分享暂存目录不可用');
  for (const entry of await readdir(staging, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^share-[a-zA-Z0-9]{6}$/.test(entry.name)) continue;
    const old = path.join(staging, entry.name);
    const details = await lstat(old).catch(() => null);
    if (details?.isDirectory() && Date.now() - details.mtimeMs > day)
      await rm(old, { recursive: true, force: true }).catch(() => {});
  }
  return mkdtemp(path.join(staging, 'share-'));
}

export async function shareKnowledgeNote(input, { readLibrary, readAttachment, staging, showMenu }) {
  const { title, text, noteId } = input ?? {};
  if (typeof title !== 'string' || title.length > 100 ||
      typeof text !== 'string' || Buffer.byteLength(text) > 600000 ||
      (noteId !== undefined && (typeof noteId !== 'string' || noteId.length > 240))) throw new Error('分享内容无效');
  if (!showMenu) return false;
  const note = noteId && readLibrary().notes.find(note => note.id === noteId);
  const inline = new Set(Array.from((note?.body ?? '').matchAll(/!\[[^\]]*\]\(attachment:([0-9a-z-]{1,80})\)/gi), match => match[1]));
  const images = (note?.attachments ?? []).filter(file => inline.has(file.id) && imageTypes.test(file.type));
  const message = [title.trim(), text.trim()].filter(Boolean).join('\n\n');
  if (!message && !images.length) return false;
  const filePaths = [];
  let directory;
  try {
    if (images.length) {
      directory = await prepareShareDirectory(staging);
      for (const [index, file] of images.entries()) {
        const bytes = await readAttachment(file.id);
        if (bytes.length !== file.size) throw new Error('图片内容与记录不一致');
        const destination = path.join(directory, `image-${index + 1}.${file.type.slice(6)}`);
        await writeFile(destination, bytes, { mode: 0o600, flag: 'wx' });
        filePaths.push(destination);
      }
    }
    // A destination may read files after the menu closes. Older exports expire on the next share.
    showMenu({ texts: message ? [message] : [], filePaths });
    return true;
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
