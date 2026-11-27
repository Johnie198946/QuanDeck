import type { OutputAttachment } from './types';
import { validMaterialTarget, type MaterialTarget } from './materialUse';
import { noteTodoTime } from './noteTodoDue';

import { isScheduleProgress, type ScheduleProgress } from './scheduleProgress';

export interface TodoOutcome {
  files?: OutputAttachment[];
  usedBy?: MaterialTarget[];
  projectId?: string;
  purpose?: string;
  at: string;
  text: string;
  url?: string;
}

export interface TodoFollowup {
  progress?: ScheduleProgress[];
  dueAt: string;
  note?: string;
  receivedAt?: string;
}

export interface NoteTodo {
  follows?: import('./scheduleProgress').FollowupSource;
  outcome?: TodoOutcome;
  followup?: TodoFollowup;
  progress?: ScheduleProgress[];
  id: string;
  lineIndex: number;
  text: string;
  dueAt: string;
  createdAt: string;
  completedAt?: string;
}

type NoteLines = { body: string; todos?: NoteTodo[] };

export function todoLineText(line: string) {
  return line.replace(/^\s*(?:(?:#{1,6}|>|[-+*]|\d+[.)])\s+)*(?:\[[ xX]\]\s*)?/, '')
    .replace(/!?\[([^\]]*)\]\(<?[^)\n]+>?\)/g, '$1')
    .replace(/(\*\*|~~|\*|`)(.+?)\1/g, '$2')
    .replace(/\\([\\*`_~[\]])/g, '$1').trim();
}

export function outcomeUrl(value: string) {
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { return undefined; }
}

export function validNoteTodos(value: unknown, body: string): value is NoteTodo[] {
  if (!Array.isArray(value)) return false;
  const lines = body.split('\n');
  const ids = new Set<string>(), rows = new Set<number>();
  const validTime = (time: unknown) => typeof time === 'string' && Number.isFinite(Date.parse(time));
  return value.every(item => {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || (!item.follows && rows.has(item.lineIndex)) ||
      !Number.isSafeInteger(item.lineIndex) || item.lineIndex < 0 || item.lineIndex >= lines.length ||
      typeof item.text !== 'string' || !item.text.trim() || !validTime(item.dueAt) || !validTime(item.createdAt) ||
      (item.progress !== undefined && (!Array.isArray(item.progress) || !item.progress.every(isScheduleProgress))) ||
      (item.completedAt !== undefined && !validTime(item.completedAt))) return false;
    const {outcome, followup} = item;
    if (outcome !== undefined && (!outcome ||
        (outcome.usedBy !== undefined && (!Array.isArray(outcome.usedBy) || !outcome.usedBy.every(validMaterialTarget))) ||
        (outcome.files !== undefined && (!Array.isArray(outcome.files) || !outcome.files.every((f:OutputAttachment) =>
          f && typeof f.id === 'string' && /^[\w-]{1,160}$/.test(f.id) && typeof f.name === 'string' &&
          !!f.name.trim() && typeof f.type === 'string' && Number.isSafeInteger(f.size) && f.size >= 0))) ||
        !validTime(outcome.at) || typeof outcome.text !== 'string' ||
        (outcome.projectId !== undefined && (typeof outcome.projectId !== 'string' || !outcome.projectId.trim() || outcome.projectId.length > 256)) ||
        (outcome.purpose !== undefined && (typeof outcome.purpose !== 'string' || outcome.purpose.length > 240)) ||
        (outcome.url !== undefined && (typeof outcome.url !== 'string' || !outcomeUrl(outcome.url))))) return false;
    if (followup !== undefined && (!followup || !validTime(followup.dueAt) ||
        (followup.receivedAt !== undefined && !validTime(followup.receivedAt)) ||
        (followup.note !== undefined && typeof followup.note !== 'string'))) return false;
    if (item.follows && (typeof item.follows.parentId !== 'string' || !item.follows.parentId ||
        typeof item.follows.progressId !== 'string' || !item.follows.progressId)) return false;
    if (followup?.progress && (!Array.isArray(followup.progress) || !followup.progress.every(isScheduleProgress))) return false;
    ids.add(item.id);
    if (!item.follows) rows.add(item.lineIndex);
    return true;
  });
}

// Shared by change history and row anchors. Trim identical ends before allocating the diff table.
export function matchingNoteLines(left: string[], right: string[]): [number, number][] {
  const matches: [number, number][] = [];
  let start = 0, end = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) {
    matches.push([start, start]);
    start++;
  }
  while (start + end < left.length && start + end < right.length &&
    left[left.length - end - 1] === right[right.length - end - 1]) end++;
  const height = left.length - start - end, width = right.length - start - end;
  if ((height + 1) * (width + 1) <= 90_000) {
    const stride = width + 1, scores = new Uint16Array((height + 1) * stride);
    for (let a = height - 1; a >= 0; a--)
      for (let b = width - 1; b >= 0; b--)
        scores[a * stride + b] = left[start + a] === right[start + b] ? 1 + scores[(a + 1) * stride + b + 1] :
          Math.max(scores[(a + 1) * stride + b], scores[a * stride + b + 1]);
    let a = 0, b = 0;
    while (a < height && b < width) {
      if (left[start + a] === right[start + b]) matches.push([start + a++, start + b++]);
      else if (scores[(a + 1) * stride + b] >= scores[a * stride + b + 1]) a++;
      else b++;
    }
  } else {
    // Common unique lines supply ordered anchors even for book-length notes.
    const positions = new Map<string, number>();
    right.slice(start, right.length - end).forEach((line, i) => positions.set(line, positions.has(line) ? -1 : start + i));
    let last = start - 1;
    for (let i = start; i < left.length - end; i++) {
      const position = positions.get(left[i]) ?? -1;
      if (position > last) { matches.push([i, position]); last = position; }
    }
  }
  for (let offset = end; offset > 0; offset--) matches.push([left.length - offset, right.length - offset]);
  return matches;
}

function changedRowPositions(before: string[], after: string[]) {
  const anchors = matchingNoteLines(before, after);
  const positions = new Map(anchors);
  const used = new Set(positions.values());
  const candidates = new Map<string, number[]>();
  for (let index = after.length - 1; index >= 0; index--) {
    const line = after[index];
    if (used.has(index) || !line) continue;
    const rows = candidates.get(line);
    if (rows) rows.push(index);
    else candidates.set(line, [index]);
  }
  // Preserve moves and reorders before pairing rewritten rows in each gap.
  before.forEach((line, index) => {
    if (positions.has(index)) return;
    const row = candidates.get(line)?.pop();
    if (row !== undefined) { positions.set(index, row); used.add(row); }
  });
  let fromOld = 0, fromNew = 0;
  for (const [oldEnd, newEnd] of [...anchors, [before.length, after.length]]) {
    const previousRows: number[] = [], nextRows: number[] = [];
    for (let i = fromOld; i < oldEnd; i++) if (!positions.has(i) && before[i]) previousRows.push(i);
    for (let i = fromNew; i < newEnd; i++) if (!used.has(i) && after[i]) nextRows.push(i);
    if (previousRows.length === nextRows.length) {
      previousRows.forEach((row, i) => positions.set(row, nextRows[i]));
    } else if (previousRows.length * nextRows.length <= 256) {
      // Typing after a todo, then pressing Enter, can save a rewrite and an insertion together.
      // Require a unique recognizable fragment before transferring the checkmark across this gap.
      for (const row of previousRows) {
        const matching = nextRows.filter(next => !used.has(next) &&
          (after[next].includes(before[row]) || before[row].includes(after[next])) &&
          Math.min(before[row].length, after[next].length) >= 2);
        if (matching.length !== 1) continue;
        const next = matching[0];
        positions.set(row, next);
        used.add(next);
      }
    }
    fromOld = oldEnd + 1;
    fromNew = newEnd + 1;
  }
  return positions;
}

export function noteTodosForBody(note: NoteLines, body: string, now = new Date()): NoteTodo[] {
  const todos = note.todos ?? [];
  if (!todos.length || note.body === body) return todos;
  const before = note.body.split('\n'), after = body.split('\n');
  const positions = changedRowPositions(before.map(todoLineText), after.map(todoLineText));
  return todos.flatMap(todo => {
    const lineIndex = positions.get(todo.lineIndex);
    if (lineIndex === undefined) return [];
    if (todo.follows) return [lineIndex === todo.lineIndex ? todo : { ...todo, lineIndex }];
    const text = todoLineText(after[lineIndex]);
    if (!text) return [];
    if (text === todo.text) return [lineIndex === todo.lineIndex ? todo : { ...todo, lineIndex }];
    const old = noteTodoTime(todo.text, now), next = noteTodoTime(text, now);
    return [{ ...todo, lineIndex, text, dueAt: old.cue === next.cue ? todo.dueAt : next.dueAt }];
  });
}
