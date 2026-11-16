import { useId, type CSSProperties } from 'react';
import type { Snapshot } from '../../data/types';
import { getTaskIdentity, type TaskFamilyColor } from '../../data/taskIdentity';
import { taskShape, taskSignature, type TaskShapePart } from './task-icon-shapes';
import './task-icon.css';

export const TASK_ICON_PALETTES: Readonly<Record<TaskFamilyColor, { name: string; stops: readonly [string, string] }>> = {
  red: { name: '红', stops: ['#bd4943', '#bd4943'] },
  yellow: { name: '黄', stops: ['#a97812', '#a97812'] },
  green: { name: '绿', stops: ['#318366', '#318366'] },
  blue: { name: '蓝', stops: ['#3976b8', '#3976b8'] },
  purple: { name: '紫', stops: ['#8053ae', '#8053ae'] },
  'red-purple': { name: '红紫渐变', stops: ['#c3454b', '#7950b5'] },
  'blue-yellow': { name: '蓝黄渐变', stops: ['#3477bf', '#b58a17'] },
  'yellow-green': { name: '黄绿渐变', stops: ['#b08a13', '#2b8c69'] },
};

function Part({ part, paint }: { part: TaskShapePart; paint: string }) {
  return <path d={part.d} transform={part.transform} fill={part.stroke ? 'none' : paint} fillRule="evenodd" stroke={part.stroke ? paint : undefined} strokeWidth={part.stroke} strokeLinecap="round" strokeLinejoin="round" />;
}

/** A pure glyph renderer, also used by the design catalogue. No state or colour meaning. */
export function TaskGlyph({ shapeIndex, color, size = 20, label, className = '' }: {
  shapeIndex: number; color: TaskFamilyColor; size?: number; label?: string; className?: string;
}) {
  const gradientId = `task-paint-${useId().replace(/:/g, '')}`;
  const shape = taskShape(shapeIndex);
  const palette = TASK_ICON_PALETTES[color] ?? TASK_ICON_PALETTES.blue;
  const gradient = palette.stops[0] !== palette.stops[1];
  const paint = gradient ? `url(#${gradientId})` : palette.stops[0];
  const accessibility = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  return <svg className={`qd-task-icon ${className}`} width={size} height={size} viewBox="-1 -1 26 26" style={{ '--task-family-color': palette.stops[0], color: palette.stops[0] } as CSSProperties}
    data-task-shape={shapeIndex} data-task-palette={color} focusable="false" {...accessibility}>
    {gradient && <defs><linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="2" y1="2" x2="22" y2="22"><stop offset="0%" stopColor={palette.stops[0]} /><stop offset="100%" stopColor={palette.stops[1]} /></linearGradient></defs>}
    <g transform={shape.generation ? 'translate(3.6 3.6) scale(.7)' : undefined}>{shape.parts.map((part, index) => <Part key={index} part={part} paint={paint} />)}</g>
    {shape.generation > 0 && taskSignature(shape.generation).map((part, index) => <Part key={`signature-${index}`} part={part} paint={paint} />)}
  </svg>;
}

/** Root tasks and their WorkItem roots resolve to one identity. Unknown entities get no fake mark. */
export function TaskIcon({ snapshot, taskId, workItemId, sessionId, subAgentId, size = 20, label, className }: {
  snapshot: Snapshot; taskId?: string; workItemId?: string; sessionId?: string; subAgentId?: string; size?: number; label?: string; className?: string;
}) {
  const identity = getTaskIdentity(snapshot, { taskId, workItemId, sessionId, subAgentId });
  if (!identity) return null;
  return <TaskGlyph shapeIndex={identity.shapeIndex} color={identity.color} size={size} label={label} className={className} />;
}
