import { parseDiscussionResponse } from "./discussionPresentation";
import { readPlanTasks } from "./projectWorkflow";
import { readPlanOutline, readDeliverySlots } from "./goalDelivery";
import { readDiscussionVisualBlocks } from "./discussionVisual";
import { readRuntimeSubmission } from "./runtimeSubmission";

/** Shared projection of public replies; preserve raw prose when protocol fields are invalid. */
export function readAgentConclusion(text: string): { charts?: import("./discussionPresentation").DiscussionChart[]; attachments?: import("./discussionPresentation").DiscussionAttachment[]; visualBlocks?: import("./discussionVisual").DiscussionVisualBlock[]; summary: string; confirmed: string[]; open: string[]; proposed?: string[]; tasks?: import('./types').TaskDraft[]; outline?: import('./types').PlanSection[]; deliverables?: import('./goalDelivery').DeliverySlotDraft[] } {
  const submission = readRuntimeSubmission(text);
  const body = submission && 'envelope' in submission && submission.envelope.kind === 'result'
    ? submission.envelope.payload.body
    : undefined;
  const candidate = typeof body === 'string' ? body : text;
  const match = /<quandeck-conclusion>\s*([\s\S]*?)\s*<\/quandeck-conclusion>/i.exec(candidate);
  const presented = parseDiscussionResponse(candidate);
  if (presented.conclusion) try {
    const value = JSON.parse(match?.[1] ?? candidate.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```$/, ''));
    if (typeof value.summary === 'string' && Array.isArray(value.confirmed) && Array.isArray(value.open) && [...value.confirmed, ...value.open].every(v => typeof v === 'string')) {
      const tasks = readPlanTasks(value.tasks),outline=readPlanOutline(value.outline),deliverables=readDeliverySlots(value.deliverables);
      const visualBlocks = readDiscussionVisualBlocks(value.visualBlocks);
      const { charts, attachments } = presented.conclusion;
      return { ...(charts.length ? { charts } : {}), ...(attachments.length ? { attachments } : {}), ...(visualBlocks.length ? {visualBlocks} : {}), summary: value.summary, confirmed: [], open: [...value.open, ...value.confirmed.map((v: string) => `Agent 提议，待用户确认：${v}`)].slice(0, 100), ...(value.confirmed.length ? { proposed: value.confirmed } : {}), ...(tasks ? { tasks } : {}),...(outline?{outline}:{}),...(deliverables?{deliverables}:{}) };
    }
  } catch { /* Preserve the original source reply when its optional payload is malformed. */ }
  return { summary: candidate, confirmed: [], open: [] };
}
