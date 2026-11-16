/** The constrained CLI fallback channel. Plain assistant prose is never a command. */
export const RUNTIME_SUBMISSION_VERSION = 'quandeck.runtime.v1' as const;
export interface RuntimeSubmissionBinding {
  projectId: string; taskId: string; workItemId?: string; runId: string; contextPackageId: string;
  taskVersion: number; specRevision: number; claimEpoch: number;
}
export interface RuntimeSubmissionEnvelope {
  schemaVersion: typeof RUNTIME_SUBMISSION_VERSION;
  idempotencyKey: string;
  binding: RuntimeSubmissionBinding;
  kind: 'result' | 'checkpoint' | 'plan_proposal' | 'blocker';
  payload: Record<string, unknown>;
}
export type RuntimeSubmissionRead = { envelope: RuntimeSubmissionEnvelope; converter: 'tagged-json-v1' } | { error: string } | null;
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
function bounded(value: unknown, depth = 0): boolean {
  if (depth > 16) return false;
  if (Array.isArray(value)) return value.length <= 100 && value.every(item => bounded(item, depth + 1));
  if (plain(value)) return Object.keys(value).length <= 32 && Object.entries(value).every(([key, item]) => !['__proto__', 'prototype', 'constructor'].includes(key) && bounded(item, depth + 1));
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}
/** Only a whole, single tagged message opts into conversion; quoting an example cannot submit it. */
export function readRuntimeSubmission(text: string): RuntimeSubmissionRead {
  if (!text.trimStart().startsWith('<quandeck-submission>')) return null;
  if (new TextEncoder().encode(text).byteLength > 131072) return { error: 'PAYLOAD_TOO_LARGE：结构化提交超过 128 KiB' };
  const match = /^\s*<quandeck-submission>\s*([\s\S]*?)\s*<\/quandeck-submission>\s*$/.exec(text);
  if (!match || /<\/?quandeck-submission>/.test(match[1])) return { error: 'SCHEMA_INVALID：需要一个完整的独立提交消息' };
  let value: unknown;
  try { value = JSON.parse(match[1]); } catch { return { error: 'SCHEMA_INVALID：提交不是有效 JSON' }; }
  if (!plain(value) || !bounded(value) || !exactKeys(value, ['schemaVersion', 'idempotencyKey', 'binding', 'kind', 'payload'])) return { error: 'SCHEMA_INVALID：提交字段或嵌套结构无效' };
  if (value.schemaVersion !== RUNTIME_SUBMISSION_VERSION) return { error: 'UNSUPPORTED_SCHEMA_VERSION：不支持的提交协议版本' };
  const binding = value.binding;
  if (typeof value.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_:.\-]{1,160}$/.test(value.idempotencyKey) || !plain(binding) || !exactKeys(binding, ['projectId','taskId','workItemId','runId','contextPackageId','taskVersion','specRevision','claimEpoch']) || !['projectId','taskId','runId','contextPackageId'].every(key => typeof binding[key] === 'string' && (binding[key] as string).length > 0 && (binding[key] as string).length <= 240) || binding.workItemId !== undefined && (typeof binding.workItemId !== 'string' || !binding.workItemId || binding.workItemId.length > 240) || !['taskVersion','specRevision','claimEpoch'].every(key => Number.isSafeInteger(binding[key]) && Number(binding[key]) >= 1) || !['result','checkpoint','plan_proposal','blocker'].includes(String(value.kind)) || !plain(value.payload)) return { error: 'SCHEMA_INVALID：提交身份、守卫或类型无效' };
  return { envelope: value as unknown as RuntimeSubmissionEnvelope, converter: 'tagged-json-v1' };
}
export function submissionInstructions(binding: RuntimeSubmissionBinding): string {
  return [
    '提交协议 quandeck.runtime.v1：普通回复只存对话；候选成果必须以独立整条消息提交以下标签，不能包含标签外的文字或 Markdown 代码围栏。不要把“已完成”作为验收。',
    `固定绑定（必须原样回显）：${JSON.stringify(binding)}`,
    '<quandeck-submission>{"schemaVersion":"quandeck.runtime.v1","idempotencyKey":"为这次逻辑提交选择唯一 ASCII 键，重试沿用","binding":上述固定绑定,"kind":"result","payload":{"title":"成果标题","body":"完整候选成果正文","sourceIds":[],"unresolved":[],"nextSteps":[]}}</quandeck-submission>',
    'kind=checkpoint 时 payload 为 {"completed":[],"remaining":[],"note":"恢复提示"}；kind=blocker 时为 {"reason":"缺少条件或权限"}；kind=plan_proposal 时为 {"tasks":[{"key":"建议内唯一局部键","title":"标题","goal":"目标","criteria":["验收项"],"owner":"me 或 agent","dependsOn":[]}]}。',
    'sourceIds 只可引用本次上下文中已登记的资料 ID。所有成果、下一步和规划都只是候选；不允许提交 status、accepted、reviewer、用户确认、实际用量或权限字段。发生预算不足时先提交 checkpoint，并停止继续执行。',
  ].join('\n');
}
