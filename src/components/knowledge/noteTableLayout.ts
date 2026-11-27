import type { NoteTableSize, NoteTableSizes } from '../../data/noteTableSizes';

export const minCellWidth = 48;
export const minRowHeight = 28;
export const maxCellSize = 2400;
const clamp = (n: number, min: number) => Math.round(Math.max(min, Math.min(maxCellSize, n)));
const safeSize = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function readTableSize(table: HTMLTableElement): NoteTableSize {
  const widths = Array.from(table.querySelectorAll<HTMLTableColElement>(':scope > colgroup[data-note-columns] > col'),
    col => Number(col.dataset.width));
  const heights: Record<number, number> = {};
  for (const row of table.rows) {
    const height = Number(row.dataset.noteHeight);
    if (safeSize(height)) heights[row.rowIndex] = height;
  }
  return { ...(widths.length && {widths}), ...(Object.keys(heights).length && {heights}) };
}

export function documentTableSizes(root: HTMLElement): NoteTableSizes {
  const sizes: NoteTableSizes = {};
  root.querySelectorAll<HTMLTableElement>('table').forEach((table, i) => {
    if (!table.hasAttribute('data-note-sized')) return;
    const value = readTableSize(table);
    if (value.widths || value.heights) sizes[i] = value;
  });
  return sizes;
}

export function applyTableSize(table: HTMLTableElement, size?: NoteTableSize) {
  let columns = table.querySelector<HTMLTableColElement>(':scope > colgroup[data-note-columns]');
  const count = table.rows[0]?.cells.length ?? 0;
  const widths = size?.widths?.slice(0, count);
  if (widths?.length && widths.every(safeSize)) {
    while (widths.length < count) widths.push(120);
    const pixels = widths.map(n => clamp(n, minCellWidth));
    const sum = pixels.reduce((a, b) => a + b, 0);
    if (!columns) {
      columns = document.createElement('colgroup');
      columns.dataset.noteColumns = '';
      table.prepend(columns);
    }
    while (columns.children.length > count) columns.lastElementChild?.remove();
    pixels.forEach((width, i) => {
      const col = columns!.children[i] as HTMLTableColElement | undefined ?? columns!.appendChild(document.createElement('col'));
      col.dataset.width = String(width);
      col.style.width = (100 * width / sum) + '%';
    });
    table.style.width = 'min(100%, ' + sum + 'px)';
    table.style.tableLayout = 'fixed';
  } else {
    columns?.remove();
    table.style.removeProperty('width');
    table.style.removeProperty('table-layout');
  }
  for (const row of table.rows) {
    const height = size?.heights?.[row.rowIndex];
    if (safeSize(height)) {
      const px = clamp(height!, minRowHeight);
      row.dataset.noteHeight = String(px);
      row.style.height = px + 'px';
    } else if (row.hasAttribute('data-note-height')) {
      delete row.dataset.noteHeight;
      row.style.removeProperty('height');
    }
  }
  table.toggleAttribute('data-note-sized', Boolean(widths?.length || size?.heights && Object.keys(size.heights).length));
}

export function restoreTableSizes(root: HTMLElement, sizes?: NoteTableSizes) {
  root.querySelectorAll<HTMLTableElement>('table').forEach((table, i) => {
    if (sizes?.[i] || table.hasAttribute('data-note-sized')) applyTableSize(table, sizes?.[i]);
  });
}
export type TableAxis = 'width' | 'height';
export function measureColumnWidths(table: HTMLTableElement) {
  return Array.from(table.rows[0].cells, c => Math.round(c.getBoundingClientRect().width));
}
export function resizeCell(cell: HTMLTableCellElement, axis: TableAxis, value: number, original: NoteTableSize, widths: number[]) {
  const table = cell.closest('table');
  if (!table || !Number.isFinite(value)) return;
  if (axis === 'height') {
    const row = (cell.parentElement as HTMLTableRowElement).rowIndex;
    applyTableSize(table, {...original, heights:{...original.heights, [row]:clamp(value, minRowHeight)}});
    return;
  }
  const next = widths.slice();
  const i = cell.cellIndex;
  let width = clamp(value, minCellWidth);
  if (i + 1 < next.length) {
    width = Math.min(width, Math.max(minCellWidth, next[i] + next[i+1] - minCellWidth));
    next[i+1] = Math.max(minCellWidth, next[i+1] + next[i] - width);
  }
  next[i] = width;
  applyTableSize(table, {...original, widths:next});
}
