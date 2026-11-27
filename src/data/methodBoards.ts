import { emptyInspirationBoard, isInspirationBoard, type InspirationBoard } from './inspirationCanvas';
import type { KnowledgeLibrary } from './knowledgeNotes';

interface BoardIdentity { id: string; title: string }
export interface MethodBoard extends BoardIdentity { board: InspirationBoard }
export interface MethodBoards { active: BoardIdentity | null; others: MethodBoard[] }
export interface MethodTemplate extends MethodBoard { summary: string; createdAt: string }
const original = { id: 'default', title: '我的画布' };

export function activeMethodBoard(library: KnowledgeLibrary): MethodBoard | undefined {
  const active = library.inspirationBoards ? library.inspirationBoards.active : original;
  return active ? { ...active, board: library.inspirationCanvas ?? emptyInspirationBoard() } : undefined;
}
export function methodBoards(library: KnowledgeLibrary): MethodBoard[] {
  const active = activeMethodBoard(library);
  return [...(active ? [active] : []), ...(library.inspirationBoards?.others ?? [])];
}
export function editableMethodBoard(library: KnowledgeLibrary, id: string): InspirationBoard {
  if (activeMethodBoard(library)?.id === id) return library.inspirationCanvas ??= emptyInspirationBoard();
  const stored = library.inspirationBoards?.others.find(item => item.id === id);
  if (!stored) throw Error('这张画布已删除，请切换画布。');
  return stored.board;
}

function titleOf(title: string) {
  const value = title.trim();
  if (!value || Array.from(value).length > 80) throw Error('请输入 1 至 80 字的名称。');
  return value;
}
function select(library: KnowledgeLibrary, next: MethodBoard | undefined, others: MethodBoard[]) {
  library.inspirationBoards = { active: next ? {id:next.id,title:next.title} : null, others };
  if (next) library.inspirationCanvas = next.board;
  else delete library.inspirationCanvas;
}
export function createMethodBoard(library: KnowledgeLibrary, title: string, templateId?: string) {
  const template = templateId ? library.methodTemplates?.find(t => t.id === templateId) : undefined;
  if (templateId && !template) throw Error('模板已删除，请重新选择。');
  const next = {id:crypto.randomUUID(), title:titleOf(title), board:template ? structuredClone(template.board) : emptyInspirationBoard()};
  select(library, next, library.inspirationCanvas || library.inspirationBoards ? methodBoards(library) : []);
  return next.id;
}
export function switchMethodBoard(library: KnowledgeLibrary, id: string) {
  if (activeMethodBoard(library)?.id === id) return;
  const all = methodBoards(library);
  const next = all.find(item => item.id === id);
  if (!next) throw Error('画布已删除。');
  select(library, next, all.filter(item => item.id !== id));
}
export function renameMethodBoard(library: KnowledgeLibrary, id: string, title: string) {
  const all = methodBoards(library);
  const item = all.find(entry => entry.id === id);
  if (!item) throw Error('画布已删除。');
  item.title = titleOf(title);
  select(library, all[0], all.slice(1));
}
export function deleteMethodBoard(library: KnowledgeLibrary, id: string) {
  const remaining = methodBoards(library).filter(item => item.id !== id);
  select(library, remaining[0], remaining.slice(1));
}
export function saveMethodTemplate(library: KnowledgeLibrary, boardId: string, title: string, summary: string, expected?: string) {
  const board = editableMethodBoard(library, boardId);
  if (!board.nodes.length) throw Error('请先在画布添加步骤。');
  if (expected && JSON.stringify(board) !== expected) throw Error('画布有更新，请重新打开保存窗口。');
  const template = { id: crypto.randomUUID(), title:titleOf(title), summary:summary.trim(), createdAt:new Date().toISOString(), board:structuredClone(board) };
  (library.methodTemplates ??= []).push(template);
  return template.id;
}
export function deleteMethodTemplate(library: KnowledgeLibrary, id: string) {
  library.methodTemplates = library.methodTemplates?.filter(t => t.id !== id);
}
export function appendMethodFragment(board: InspirationBoard, fragment: InspirationBoard) {
  if (!fragment.nodes.length || !isInspirationBoard(fragment)) throw Error('导入内容缺少有效的步骤或连线。');
  const placed = new Set(board.nodes.map(n => n.noteId));
  if (fragment.nodes.every(node => placed.has(node.noteId))) return;
  if (fragment.nodes.some(n => placed.has(n.noteId)) || fragment.links.some(link => board.links.some(l => l.id === link.id))) throw Error('卡片编号冲突，请重新导入。');
  const copy = structuredClone(fragment);
  const shift = board.nodes.length ? Math.max(...board.nodes.map(n=>n.x)) + 270 - Math.min(...copy.nodes.map(n=>n.x)) : 0;
  board.nodes.push(...copy.nodes.map(node => ({...node, x:node.x+shift})));
  board.links.push(...copy.links);
}
export function methodFileIds(library: KnowledgeLibrary) {
  const files = new Set<string>();
  for (const {board} of [...methodBoards(library), ...(library.methodTemplates ?? [])]) for (const node of board.nodes) {
    const source = node.idea?.reference;
    if (source && 'file' in source) files.add(source.file.id);
  }
  return files;
}
export function validateMethodCollections(value: KnowledgeLibrary) {
  function identity(item: BoardIdentity) { return !!item && typeof item.id === 'string' && !!item.id && typeof item.title === 'string' && !!item.title.trim(); }
  const list = value.inspirationBoards;
  if (list !== undefined && (!list || !Array.isArray(list.others) ||
      (list.active === null ? value.inspirationCanvas !== undefined || list.others.length > 0 : !identity(list.active) || !value.inspirationCanvas) ||
      list.others.some(item => !identity(item) || !isInspirationBoard(item.board)) ||
      new Set([list.active?.id, ...list.others.map(item=>item.id)]).size !== list.others.length+1))
    throw Error('无法读取多画布数据，已保留原文件。');
  const templates = value.methodTemplates;
  if (templates !== undefined && (!Array.isArray(templates) || templates.some(t => !identity(t) || typeof t.summary !== 'string' ||
      !Number.isFinite(Date.parse(t.createdAt)) || !isInspirationBoard(t.board)) || new Set(templates.map(t=>t.id)).size !== templates.length))
    throw Error('无法读取方法模板，已保留原文件。');
}
