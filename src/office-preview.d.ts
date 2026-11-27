declare module '*office-preview.mjs' {
  type RuntimeAttachmentPreview = import('./integration/desktop').RuntimeAttachmentPreview;
  type OfficeKind = 'document' | 'spreadsheet' | 'slides';
  type Content<T> = T extends { kind: OfficeKind } ? Omit<T, 'name' | 'path' | 'size'> : never;
  export function parseOfficePreview(bytes: Uint8Array, kind: OfficeKind): Content<RuntimeAttachmentPreview>;
}
