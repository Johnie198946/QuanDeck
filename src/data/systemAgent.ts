import type { Agent, Snapshot } from './types';

/** System AI follows the user's persisted configuration list, not catalog/default/star order. */
export function firstSystemAgent(snapshot: Snapshot, configured: unknown): Agent | null {
  if (!Array.isArray(configured) || configured.length === 0) return null;
  const first = configured[0];
  if (!first || typeof first !== 'object' || typeof first.tool !== 'string') return null;
  const agentId = typeof first.agentId === 'string' && first.agentId ? first.agentId : first.tool;
  return snapshot.agents.find(agent => agent.id === agentId) ?? null;
}
export function configuredSystemAgent(snapshot: Snapshot): Agent | null {
  try { return firstSystemAgent(snapshot, JSON.parse(globalThis.localStorage?.getItem('quandeck.configured-agents.v1') ?? '[]')); }
  catch { return null; }
}
