/** Portable, project-relative identity for a registered file; never a filesystem read. */
export function projectFilePath(value?: string) {
  if (!value || value.length > 8192 || /[:?#\u0000-\u001f\u007f]/.test(value)) return;
  const parts = value.replace(/\\/g, '/').split('/');
  if (parts[0] === '.') parts.shift();
  return parts.every(part => part && part !== '.' && part !== '..') ? parts.join('/') : undefined;
}
