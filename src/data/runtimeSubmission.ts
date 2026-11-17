import { parseHandoffContent } from './taskHandoff';
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
  if (!match) return { error: 'SCHEMA_INVALID：需要一个完整的独立提交消息' };
  let value: unknown;
  try { value = JSON.parse(match[1]); } catch { return { error: 'SCHEMA_INVALID：提交不是有效 JSON' }; }
  if (!plain(value) || !bounded(value) || !exactKeys(value, ['schemaVersion', 'idempotencyKey', 'binding', 'kind', 'payload'])) return { error: 'SCHEMA_INVALID：提交字段或嵌套结构无效' };
  if (value.schemaVersion !== RUNTIME_SUBMISSION_VERSION) return { error: 'UNSUPPORTED_SCHEMA_VERSION：不支持的提交协议版本' };
  const binding = value.binding;
  if (typeof value.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_:.\-]{1,160}$/.test(value.idempotencyKey) || !plain(binding) || !exactKeys(binding, ['projectId','taskId','workItemId','runId','contextPackageId','taskVersion','specRevision','claimEpoch']) || !['projectId','taskId','runId','contextPackageId'].every(key => typeof binding[key] === 'string' && (binding[key] as string).length > 0 && (binding[key] as string).length <= 240) || binding.workItemId !== undefined && (typeof binding.workItemId !== 'string' || !binding.workItemId || binding.workItemId.length > 240) || !['taskVersion','specRevision','claimEpoch'].every(key => Number.isSafeInteger(binding[key]) && Number(binding[key]) >= 1) || !['result','checkpoint','plan_proposal','blocker'].includes(String(value.kind)) || !plain(value.payload)) return { error: 'SCHEMA_INVALID：提交身份、守卫或类型无效' };
  if (value.payload.handoff !== undefined) {
    if (value.kind !== 'result') return { error: 'SCHEMA_INVALID：交接内容只能随候选成果录入' };
    try { parseHandoffContent(value.payload.handoff); }
    catch (error) { return { error: 'HANDOFF_INVALID：' + (error instanceof Error ? error.message : '交接内容无效') }; }
  }
  return { envelope: value as unknown as RuntimeSubmissionEnvelope, converter: 'tagged-json-v1' };
}
export function submissionInstructions(binding: RuntimeSubmissionBinding): string {
  return [
    '提交协议 quandeck.runtime.v1：普通回复只存对话；候选成果必须以独立整条消息提交以下标签，不能包含标签外的文字或 Markdown 代码围栏。不要把“已完成”作为验收。',
    `固定绑定（必须原样回显）：${JSON.stringify(binding)}`,
    '<quandeck-submission>{"schemaVersion":"quandeck.runtime.v1","idempotencyKey":"为这次逻辑提交选择唯一 ASCII 键，重试沿用","binding":上述固定绑定,"kind":"result","payload":{"title":"成果标题","body":"完整候选成果正文","sourceIds":[],"unresolved":[],"nextSteps":[]}}</quandeck-submission>',
    'kind=checkpoint 时 payload 为 {"completed":[],"remaining":[],"note":"恢复提示"}；kind=blocker 时为 {"reason":"缺少条件或权限"}；kind=plan_proposal 时为 {"tasks":[{"key":"建议内唯一局部键","title":"标题","goal":"目标","criteria":["验收项"],"owner":"me 或 agent","dependsOn":[]}]}。',
    'result payload 可提供 handoff:{"summary":"本次总结","completed":[],"decisions":[],"remaining":[],"nextSteps":[]}，只填写内容；decisions 是工作说明，不是用户授权。remaining 只记录本任务尚未完成或阻塞的事项，后续任务的建议写 nextSteps；交给后续任务不代表本任务未完成。系统将自动校验并生成带任务、运行、规范、来源和成果哈希的交接记录；省略时系统从本次成果、未解决项及下一步生成固定记录。不得在 handoff 中写 id、身份、hash 或验收状态。',
    '当前是任务执行阶段：按已确认范围直接完成当前这项任务，不输出 quandeck-conclusion 或重复确认表。如果任务已有子任务，只处理本次分配的部分；仅在本次上下文明示可引用的子成果齐备后汇总（可以是此自动计划内获准引用的候选成果；候选不代表人工验收）。公开进展用简短 checkpoint 列出已完成与剩余工作。',
    '交付实际文件时，在 body 正文中为每份文件提供 Markdown 本地链接：[文件名](项目内相对路径)，带空格的路径用 <路径> 包围。先确认文件已写入当前项目目录，再声明对应交付槽完成；不能只列文件名或以不存在的路径代替交付。正文同时说明用途和核对结果，便于在成果地图预览、读取规范正文和追溯来源。',
    '当上下文给出交付槽时，result payload 添加 deliverySlotIds:[实际完成的槽ID]；带 contract 的交付件必须逐件提供 deliveryItems:[{slotId,contractRevision,body}]（text）或 {slotId,contractRevision,path,name?}（file；path 为已经写入的实际项目文件路径；已有登记附件也可用 attachmentId 代替 path）。每件有独立正文或已登记附件，不能自行填 hash、verified、验收状态；附件字节由系统核验；未完成的槽保留空位，不宣称验收。unresolved 仅记录阻止本次交付或后续依赖执行的实际缺口；可选改进放 nextSteps，候选仍待人工核对本身不是缺口。交付槽未补齐或 unresolved 非空时只保存部分进展，不会启动后续依赖。sourceIds 只可引用本次上下文中已登记的资料 ID。所有成果、下一步和规划都只是候选；不允许提交 status、accepted、reviewer、用户确认、实际用量或权限字段。源 Agent 报告额度不足或中断时保留 checkpoint；QuanDeck 不设置 Token 上限。',
  ].join('\n');
}
