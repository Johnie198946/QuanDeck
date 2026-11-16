import assert from "node:assert/strict";
import { createUsageAccounting, recordUsageReceipt, summarizeUsage, buildQualityCostReport, type UsageReceipt } from "../src/data/usageAccounting";
import { createEmptySnapshot } from "../src/data/projectStorage";
const state = createUsageAccounting(), projectId = "accounting";
const receipt: UsageReceipt = { id: "provider-1", projectId, runId: "run-1", sequence: 1,
  at: "2026-11-16T00:00:00Z", provider: "provider", model: "model", purpose: "execution", totalTokens: 80,
  inputTokens: 40, outputTokens: 20, cacheReadTokens: 15, cacheWriteTokens: 5,
  billedMicros: 1000, toolBilledMicros: 250, currency: "USD", final: false };
assert.equal(recordUsageReceipt(state, receipt, projectId), "recorded");
assert.equal(recordUsageReceipt(state, receipt, projectId), "duplicate");
assert.throws(() => recordUsageReceipt(state, { ...receipt, totalTokens: 1 }, projectId), /不可改写/);
assert.throws(() => recordUsageReceipt(state, { ...receipt, id: "foreign", projectId: "foreign" }, projectId), /身份/);
assert.throws(() => recordUsageReceipt(state, { ...receipt, id: "regress", sequence: 2, totalTokens: 79 }, projectId), /倒退/);
assert.throws(() => recordUsageReceipt(state, { ...receipt, id: "invalid", sequence: 2, billedMicros: -1 }, projectId), /非负/);
assert.throws(() => recordUsageReceipt(state, { ...receipt, id: "currency", sequence: 2, currency: undefined }, projectId), /币种/);
recordUsageReceipt(state, { ...receipt, id: "provider-2", sequence: 2, totalTokens: 100, outputTokens: 40, billedMicros: 2000, final: true }, projectId);
assert.throws(() => recordUsageReceipt(state, { ...receipt, id: "post-final", sequence: 3 }, projectId), /终态/);
const known = summarizeUsage(state, projectId);
assert.equal(known.knownTokens, 100, "cumulative receipts are not summed twice");
assert.equal(known.currencies.USD.modelMicros, 2000);
assert.equal(known.currencies.USD.toolMicros, 250);
assert(known.moneyComplete); assert(known.breakdownComplete);
recordUsageReceipt(state, { id: "unknown", projectId, runId: "run-2", sequence: 1, at: receipt.at,
  provider: "other", purpose: "review", totalTokens: null, final: true }, projectId);
const mixed = summarizeUsage(state, projectId);
assert.equal(mixed.knownTokens, 100);
assert.equal(mixed.unknownMoneyRuns, 1); assert.equal(mixed.unknownTokenRuns, 1);
assert(!mixed.moneyComplete); assert(!mixed.breakdownComplete);
assert.equal(summarizeUsage(state, "foreign").knownTokens, 0);
const before = JSON.stringify(state);
const report = buildQualityCostReport(createEmptySnapshot({ id: projectId, name: "test" }), state);
assert.equal(report.quality.firstPassRate, null); assert.equal(report.quality.semanticsEvaluated, false);
assert.equal(JSON.stringify(state), before);
console.log("usage accounting: adapter receipts, exact replay, immutable IDs, cumulative deduplication, monetary currencies, unknowns and quality report passed");
