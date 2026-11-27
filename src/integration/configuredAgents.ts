import { useEffect, useState } from "react";
import type { WorkdeckDataSource, AgentRegistration } from "../data/repository";
import type { Agent } from "../data/types";
import type { ConnectionInput, ConnectionTest, ToolId } from "./contracts";
import type { RuntimeCommands, RuntimeConnectionBinding } from "../data/runtimeContracts";
import { desktopHost } from "./desktop";
import { TOOL_LABELS } from "./contracts";
import { applicationAgentProfileLabel, reusableAgentProfiles } from './agentProfiles';
import { getTestedConnections, removeTestedConnection } from "./gateway";

export interface ConfiguredAgent extends ConnectionInput {
  id: string;
  scope?: 'application';
  tool: ToolId;
  projectPath: string;
  configuredAt: string;
  connectionId?: string;
  capabilities?: ConnectionTest['capabilities'];
  previousApplicationConnection?: ConnectionInput & { connectionId: string };
  previousConnection?: { input: ConnectionInput; binding: RuntimeConnectionBinding; projectId: string };
}
export { replaceConfiguredAgentConnection, restoreConfiguredAgentConnection } from './agentConnectionReplacement';
export const CONFIGURED_AGENTS_KEY = "quandeck.configured-agents.v1";
const KEY = CONFIGURED_AGENTS_KEY;
const EVENT = "quandeck:agent-configured";
const COLORS: Record<ToolId, string> = { codex: "#527f9e", claude: "#bd7856", cursor: "#6e6d8a", opencode: "#527b6b", dsh: "#526dc5", hermes: "#776356", workbuddy: "#527f9e" };
export function getConfiguredAgents(): ConfiguredAgent[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(value) ? value.filter((entry) => entry && typeof entry.id === "string" && Object.prototype.hasOwnProperty.call(TOOL_LABELS, entry.tool) && typeof entry.projectPath === "string") : [];
  } catch { return []; }
}
export function configuredAgentIdentity(tool: ToolId, profile?: Pick<ConnectionInput, 'agentId' | 'displayName'>): AgentRegistration {
  const name = profile?.displayName?.trim() || TOOL_LABELS[tool];
  return { id: profile?.agentId || tool, name, short: name, color: COLORS[tool] };
}
/** The business service owns identity; local connection preferences are saved only after registration succeeds. */
export function connectionCanSave(result: ConnectionTest | undefined | null): result is ConnectionTest & { connectionId: string } {
  return !!result?.connectionId && (result.status === "ready" || result.discussionOpen === true);
}
export async function persistAgentConfiguration(api: Pick<WorkdeckDataSource, "registerAgent"> & Partial<Pick<RuntimeCommands, "bindRuntimeConnection">>, input: ConnectionInput, receipt?: ConnectionTest, options?: {applicationDefault?: boolean}) {
  const agentId = input.agentId || input.tool;
  const tested = receipt ?? getTestedConnections().find(entry => entry.tool === input.tool && (entry.agentId || entry.tool) === agentId && entry.projectPath === input.projectPath.trim());
  if (!connectionCanSave(tested) || tested.tool !== input.tool || tested.projectPath !== input.projectPath.trim()) throw new Error("请先测试当前工具与项目连接，验证成功后再保存");
  if ((tested.agentId || tested.tool) !== agentId) throw new Error("连接身份已变化，请重新测试后保存");
  for (const key of ["binary", "nodePath", "provider", "model"] as const) {
    if (input[key]?.trim() && tested[key] !== input[key]!.trim()) throw new Error("连接参数已变化，请重新测试后保存");
  }
  if (JSON.stringify(input.dshModelSource ?? null) !== JSON.stringify(tested.dshModelSource ?? null)) throw new Error("模型来源已变化，请重新测试后保存");
  if (tested.status === "ready" && tested.capabilities.dispatch && !options?.applicationDefault && !api.bindRuntimeConnection) throw new Error("请使用桌面版连接本地执行服务");
  const first = input.tool !== "workbuddy" && !getConfiguredAgents().some(entry => entry.tool !== "workbuddy");
  const result = await api.registerAgent({ ...configuredAgentIdentity(input.tool, input), ...(input.tool === "workbuddy" ? { makeDefault: false } : first ? { makeDefault: true } : {}) });
  if (!result.ok) throw new Error(result.message ?? "Agent 身份登记失败，配置尚未保存");
  if (tested.status === "ready" && tested.capabilities.dispatch && !options?.applicationDefault) {
    const bound = await api.bindRuntimeConnection!(agentId, {connectionId:tested.connectionId,tool:tested.tool,projectPath:tested.projectPath,capabilities:tested.capabilities,provider:tested.provider,model:tested.model});
    if (!bound.ok) throw new Error(bound.message ?? "本地执行连接尚未绑定，请重试");
  }
  return saveConfiguredAgent({ ...input, binary:tested.binary ?? input.binary, connectionId:tested.connectionId, capabilities:tested.capabilities, ...(options?.applicationDefault ? {scope:'application' as const} : {}) });
}
export async function saveConfiguredAgent(input: ConnectionInput & { connectionId?: string; scope?: 'application'; capabilities?: ConnectionTest['capabilities'] }) {
  const records = getConfiguredAgents();
  const existing = records.find((entry) => (entry.agentId || entry.tool) === (input.agentId || input.tool) && (input.scope === 'application' ? entry.scope === 'application' : entry.scope !== 'application' && entry.projectPath === input.projectPath.trim()));
  const record = { ...input, projectPath: input.projectPath.trim(), id: existing?.id ?? crypto.randomUUID(), configuredAt: new Date().toISOString() };
  const retained = records.filter((entry) => entry.id !== record.id);
  if (record.scope === 'application') {
    const index=existing ? records.findIndex(entry => entry.id === existing.id) : retained.findIndex(entry => (entry.agentId || entry.tool) === (record.agentId || record.tool));
    retained.splice(index < 0 ? retained.length : index,0,record);
  } else retained.push(record);
  const value = JSON.stringify(retained);
  await desktopHost()?.savePreference(KEY, value);
  localStorage.setItem(KEY, value);
  window.dispatchEvent(new Event(EVENT));
  return record;
}
export async function removeConfiguredAgent(id: string) {
  const previous = getConfiguredAgents().find((entry) => entry.id === id);
  const value = JSON.stringify(getConfiguredAgents().filter((entry) => previous ? (entry.agentId || entry.tool) !== (previous.agentId || previous.tool) : entry.id !== id));
  await desktopHost()?.savePreference(KEY, value);
  if (previous) removeTestedConnection(previous.tool, previous.projectPath, previous.connectionId);
  localStorage.setItem(KEY, value);
  window.dispatchEvent(new Event(EVENT));
}
export function testForConfig(config: ConfiguredAgent, tested: ConnectionTest[]) {
  return tested.find((entry) => config.connectionId ? entry.connectionId === config.connectionId : entry.tool === config.tool && (entry.agentId || entry.tool) === (config.agentId || config.tool) && entry.projectPath === config.projectPath);
}
export function toolForAgent(agent: Agent): ToolId | undefined {
  const profile = getConfiguredAgents().find(entry => (entry.agentId || entry.tool) === agent.id);
  if (profile) return profile.tool;
  if (agent.id === "claude" || agent.name === "Claude Code") return "claude";
  if (agent.id === "codex" || agent.name === "Codex") return "codex";
  if (agent.id === "cursor" || agent.name === "Cursor") return "cursor";
  if (agent.id === "opencode" || agent.name === "OpenCode") return "opencode";
  if (agent.id === "hermes" || agent.name === "Hermes") return "hermes";
  if (agent.id === "workbuddy" || agent.name === "WorkBuddy") return "workbuddy";
  if (agent.id === "dsh" || agent.name === "DeepSeek Harness") return "dsh";
}
export function applicationAgentEntries(records:ConfiguredAgent[]) {
  return [...new Set(records.map(entry=>entry.agentId || entry.tool))].map(id=>records.find(entry=>(entry.agentId || entry.tool)===id && entry.scope==='application') ?? records.find(entry=>(entry.agentId || entry.tool)===id)!);
}
export function useConfiguredAgents(snapshotAgents: Agent[]) {
  const [configured, setConfigured] = useState(getConfiguredAgents);
  const [tested, setTested] = useState(getTestedConnections);
  useEffect(() => {
    const update = () => { setConfigured(getConfiguredAgents()); setTested(getTestedConnections()); };
    for (const name of [EVENT, "quandeck:gateway-tested", "quandeck:gateway-settings", "storage"]) window.addEventListener(name, update);
    return () => { for (const name of [EVENT, "quandeck:gateway-tested", "quandeck:gateway-settings", "storage"]) window.removeEventListener(name, update); };
  }, []);
  const identities = [...new Set(configured.map((entry) => entry.agentId || entry.tool))];
  const agents = identities.flatMap(id => {
    const agent = snapshotAgents.find(entry => entry.id === id);
    return agent ? [agent] : [];
  });
  agents.push(...snapshotAgents.filter((agent) => agent.custom && !agents.some((current) => current.id === agent.id)));
  const profileLabels=Object.fromEntries(identities.map(id=>[id,applicationAgentProfileLabel(id,configured)]));
  return { configured:applicationAgentEntries(configured), reusableProfiles:reusableAgentProfiles(configured).profiles, tested, agents, profileLabels };
}
