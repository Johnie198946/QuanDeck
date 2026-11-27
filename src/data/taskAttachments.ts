import type { OutputAttachment } from './types';

export const MAX_TASK_ATTACHMENTS = 20;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export function noteImageLimitIssue(files:readonly OutputAttachment[]) {
  const images = files.filter(file=>/^image\/(?:png|jpeg|gif|webp)$/iu.test(file.type));
  return images.length > 4 || images.reduce((sum,file)=>sum+file.size,0) > 8*1024*1024
    ? '每次可发送最多 4 张图片，合计 8 MB。请调整所选图片。' : undefined;
}
export function validateTaskAttachments(files: OutputAttachment[]): OutputAttachment[] {
  if (!Array.isArray(files) || files.length > MAX_TASK_ATTACHMENTS) throw new Error('每个任务最多添加 20 个附件');
  const ids = new Set<string>();
  return files.map(file => {
    if (!file || typeof file.id !== 'string' || !/^[\w-]{1,160}$/.test(file.id) || ids.has(file.id) || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 255 || /[\0\r\n]/.test(file.name) || typeof file.type !== 'string' || file.type.length > 255 || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_ATTACHMENT_BYTES) throw new Error('附件信息无效或超过 25 MB');
    ids.add(file.id);
    return { id: file.id, name: file.name, type: file.type, size: file.size };
  });
}
