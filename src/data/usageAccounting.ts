import { hashText } from "./collaboration";
import type { Snapshot } from "./types";

/** Provider-reported cumulative totals per run. No prices or spend are inferred from model text. */
export interface UsageReceipt {
  id: string;
  projectId: string;
  runId: string;
  sequence: number;
  at: string;
  provider: string;
  model?: string;
  purpose: "discussion" | "execution" | "review" | "classify" | "summary" | "title" | "integration";
  totalTokens: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  /** Actual reported charge in millionths of currency; null/absent means unknown. */
  billedMicros?: number | null;
  currency?: string;
  toolBilledMicros?: number | null;
  final: boolean;
}
export interface UsageAccountingState { schema: 1; receipts: UsageReceipt[] }
export const createUsageAccounting = (): UsageAccountingState => ({ schema: 1, receipts: [] });
const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };
const fields = ["totalTokens", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "billedMicros", "toolBilledMicros"] as const;

/** Called only by an authenticated adapter receipt handler, never an AI submission command. */
export function recordUsageReceipt(state: UsageAccountingState, receipt: UsageReceipt, expectedProjectId: string): "recorded" | "duplicate" {
  if (!receipt.id || !receipt.runId || receipt.projectId !== expectedProjectId ||
      !receipt.provider || !Number.isSafeInteger(receipt.sequence) || receipt.sequence < 0 ||
      !Number.isFinite(Date.parse(receipt.at)) || typeof receipt.final !== "boolean" ||
      !["discussion", "execution", "review", "classify", "summary", "title", "integration"].includes(receipt.purpose))
    fail("USAGE_INVALID", "用量回执身份或序号无效");
  for (const key of fields) if (receipt[key] != null && (!Number.isSafeInteger(receipt[key]) || receipt[key]! < 0))
    fail("USAGE_INVALID", "用量与实际金额必须是非负整数或未知");
  if ((receipt.billedMicros != null || receipt.toolBilledMicros != null) && !/^[A-Z]{3}$/.test(receipt.currency ?? ""))
    fail("USAGE_INVALID", "实际费用必须带币种");
  const existing = state.receipts.find((r) => r.projectId === receipt.projectId && r.id === receipt.id);
  const canonical = (r: UsageReceipt) => JSON.stringify(Object.keys(r).sort().map((key) => [key, r[key as keyof UsageReceipt]]));
  if (existing) {
    if (canonical(existing) !== canonical(receipt)) fail("USAGE_RECEIPT_CONFLICT", "同一用量回执不可改写");
    return "duplicate";
  }
  const stream = state.receipts.filter((r) => r.projectId === receipt.projectId && r.runId === receipt.runId);
  const latest = stream.sort((a, b) => b.sequence - a.sequence)[0];
  if (stream.some((r) => r.sequence === receipt.sequence)) fail("USAGE_RECEIPT_CONFLICT", "同一运行序号已有回执");
  if (latest && (receipt.sequence <= latest.sequence || latest.final || latest.provider !== receipt.provider || latest.purpose !== receipt.purpose))
    fail("USAGE_SEQUENCE", "终态或过期的用量回执不能覆盖当前回执");
  if (latest) for (const key of fields) {
    if (latest[key] != null && receipt[key] != null && receipt[key]! < latest[key]!)
      fail("USAGE_REGRESSION", "累积用量不得倒退；新的计量周期须使用新的运行ID");
  }
  state.receipts.push(structuredClone(receipt));
  return "recorded";
}

export function summarizeUsage(state: UsageAccountingState, projectId: string) {
  const latest = new Map<string, UsageReceipt>();
  for (const r of state.receipts) if (r.projectId === projectId && (!latest.has(r.runId) || latest.get(r.runId)!.sequence < r.sequence)) latest.set(r.runId, r);
  const runs = [...latest.values()];
  const known = (field: typeof fields[number]) => runs.reduce((sum, r) => sum + (r[field] ?? 0), 0);
  const currencies: Record<string, { modelMicros: number; toolMicros: number; runs: number }> = {};
  for (const r of runs) if (r.currency && (r.billedMicros != null || r.toolBilledMicros != null)) {
    const bucket = currencies[r.currency] ??= { modelMicros: 0, toolMicros: 0, runs: 0 };
    bucket.modelMicros += r.billedMicros ?? 0; bucket.toolMicros += r.toolBilledMicros ?? 0; bucket.runs++;
  }
  const unknownMoneyRuns = runs.filter((r) => r.billedMicros == null || r.toolBilledMicros == null || !r.final).length;
  return {
    runs: runs.length, receipts: state.receipts.filter((r) => r.projectId === projectId).length,
    knownTokens: known("totalTokens"), unknownTokenRuns: runs.filter((r) => r.totalTokens == null || !r.final).length,
    inputTokens: known("inputTokens"), outputTokens: known("outputTokens"),
    cacheReadTokens: known("cacheReadTokens"), cacheWriteTokens: known("cacheWriteTokens"),
    breakdownComplete: runs.length > 0 && runs.every((r) => r.final && [r.inputTokens, r.outputTokens, r.cacheReadTokens, r.cacheWriteTokens].every((v) => v != null)),
    currencies, unknownMoneyRuns, moneyComplete: runs.length > 0 && unknownMoneyRuns === 0,
    byPurpose: Object.fromEntries([...new Set(runs.map((r) => r.purpose))].map((purpose) => [purpose, runs.filter((r) => r.purpose === purpose).length])),
  };
}

/** Descriptive measurements, not a claim that an AI answer is semantically correct. */
export function buildQualityCostReport(snapshot: Snapshot, state: UsageAccountingState) {
  const c = snapshot.collaboration;
  const reviews = c?.reviews ?? [], submissions = c?.submissions ?? [];
  const firstReview = new Map<string, typeof reviews[number]>();
  for (const r of reviews) if (!firstReview.has(r.key)) firstReview.set(r.key, r);
  const attempts = [...firstReview.values()];
  const actual = summarizeUsage(state, snapshot.project.id);
  const expected = [...Object.keys(c?.runs ?? {}),
    ...Object.values(snapshot.intelligence?.jobs ?? {}).filter(job => job.status !== "queued").map(job => `system:${job.id}`),
    ...Object.keys(snapshot.integration?.reviewJobs ?? {}).map(id => `system:${id}`)];
  const recorded = new Set(state.receipts.filter(receipt => receipt.projectId === snapshot.project.id).map(receipt => receipt.runId));
  const unaccountedRuns = expected.filter(id => !recorded.has(id));
  return {
    schema: "quandeck.quality-cost.v1", projectId: snapshot.project.id,
    sourceSequence: c?.sequence ?? 0, generatedAt: new Date().toISOString(),
    usage: actual,
    coverage: { expectedRuns: expected.length, recordedRuns: recorded.size, unaccountedRuns,
      complete: unaccountedRuns.length === 0, totalCostKnown: unaccountedRuns.length === 0 && actual.moneyComplete },
    quality: {
      submissions: submissions.length, reviews: reviews.length,
      acceptedReviews: reviews.filter((r) => r.verdict === "accepted").length,
      firstPassRate: attempts.length ? attempts.filter((r) => r.verdict === "accepted").length / attempts.length : null,
      humanInterventions: c?.events.filter((e) => e.actor === "human" && ["spec_revised", "legacy_scope_revised", "decision_recorded", "task_reopened", "run_reconciled"].includes(e.type)).length ?? 0,
      semanticsEvaluated: false,
    },
    contexts: (c?.contextPackages ?? []).map((pack) => ({ id: pack.id, hash: pack.hash,
      inputEstimate: pack.estimatedTokens, budget: pack.tokenBudget, sources: pack.sources.length,
      partialSources: pack.sources.filter((s) => s.truncated).length, omittedSources: pack.omittedSources,
      evidenceReads: (snapshot.contextEvidenceReads ?? []).filter(read => read.contextPackageId === pack.id).length,
      deliveredTokensEstimate: pack.estimatedTokens + (snapshot.contextEvidenceReads ?? []).filter(read => read.contextPackageId === pack.id).reduce((sum, read) => sum + read.estimatedTokens, 0) })),
    sourceHash: hashText(JSON.stringify({ sequence: c?.sequence, receipts: state.receipts, evidenceReads: snapshot.contextEvidenceReads, reviews })),
  };
}
