// User-set dimensions live beside the note. Its Markdown remains portable and searchable.
export interface NoteTableSize {
  widths?: number[];
  heights?: Record<number, number>;
}
export type NoteTableSizes = Record<number, NoteTableSize>;

export function sameTableSizes(a?: NoteTableSizes, b?: NoteTableSizes) {
  return a === b || JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}
