import { useEffect, useState } from "react";
import type { WorkdeckDataSource, AgentRegistration } from "../data/repository";
import type { Agent } from "../data/types";
import type { ConnectionTest, ToolId } from "./contracts";
import { TOOL_LABELS } from "./contracts";
import { getTestedConnections, removeTestedConnection } from "./gateway";

export interface ConfiguredAgent {
  id: string;
  tool: ToolId;
  projectPath: string;
  configuredAt: string;
}
const KEY = "quandeck.configured-agents.v1";
const EVENT = "quandeck:agent-configured";
const COLORS: Record<ToolId, string> = { codex: "#527f9e", claude: "#bd7856", cursor: "#6e6d8a", opencode: "#527b6b" };
export function getConfiguredAgents(): ConfiguredAgent[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(value) ? value.filter((entry) => entry && typeof entry.id === "string" && Object.prototype.hasOwnProperty.call(TOOL_LABELS, entry.tool) && typeof entry.projectPath === "string") : [];
  } catch { return []; }
}
export function configuredAgentIdentity(tool: ToolId): AgentRegistration {
  return { id: tool, name: TOOL_LABELS[tool], short: TOOL_LABELS[tool], color: COLORS[tool] };
}
/** The business service owns identity; local connection preferences are saved only after registration succeeds. */
export async function persistAgentConfiguration(api: Pick<WorkdeckDataSource, "registerAgent">, input: Pick<ConfiguredAgent, "tool" | "projectPath">) {
  const first = getConfiguredAgents().length === 0;
  const result = await api.registerAgent({ ...configuredAgentIdentity(input.tool), ...(first ? { makeDefault: true } : {}) });
  if (!result.ok) throw new Error(result.message ?? "Agent 身份登记失败，配置尚未保存");
  return saveConfiguredAgent(input);
}
export function saveConfiguredAgent(input: Pick<ConfiguredAgent, "tool" | "projectPath">) {
  const records = getConfiguredAgents();
  const existing = records.find((entry) => entry.tool === input.tool && entry.projectPath === input.projectPath.trim());
  const record = { ...input, projectPath: input.projectPath.trim(), id: existing?.id ?? crypto.randomUUID(), configuredAt: new Date().toISOString() };
  localStorage.setItem(KEY, JSON.stringify([...records.filter((entry) => entry.id !== record.id), record]));
  window.dispatchEvent(new Event(EVENT));
  return record;
}
export function removeConfiguredAgent(id: string) {
  const previous = getConfiguredAgents().find((entry) => entry.id === id);
  if (previous) removeTestedConnection(previous.tool, previous.projectPath);
  localStorage.setItem(KEY, JSON.stringify(getConfiguredAgents().filter((entry) => entry.id !== id)));
  window.dispatchEvent(new Event(EVENT));
}
export function testForConfig(config: ConfiguredAgent, tested: ConnectionTest[]) {
  return tested.find((entry) => entry.tool === config.tool && entry.projectPath === config.projectPath);
}
export function toolForAgent(agent: Agent): ToolId | undefined {
  if (agent.id === "claude" || agent.name === "Claude Code") return "claude";
  if (agent.id === "codex" || agent.name === "Codex") return "codex";
  if (agent.id === "cursor" || agent.name === "Cursor") return "cursor";
  if (agent.id === "opencode" || agent.name === "OpenCode") return "opencode";
}
export function useConfiguredAgents(snapshotAgents: Agent[]) {
  const [configured, setConfigured] = useState(getConfiguredAgents);
  const [tested, setTested] = useState(getTestedConnections);
  useEffect(() => {
    const update = () => { setConfigured(getConfiguredAgents()); setTested(getTestedConnections()); };
    for (const name of [EVENT, "quandeck:gateway-tested", "quandeck:gateway-settings", "storage"]) window.addEventListener(name, update);
    return () => { for (const name of [EVENT, "quandeck:gateway-tested", "quandeck:gateway-settings", "storage"]) window.removeEventListener(name, update); };
  }, []);
  const tools = [...new Set(configured.map((entry) => entry.tool))];
  const agents = tools.flatMap(tool => {
    const agent = snapshotAgents.find(entry => toolForAgent(entry) === tool);
    return agent ? [agent] : [];
  });
  agents.push(...snapshotAgents.filter((agent) => agent.custom && !agents.some((current) => current.id === agent.id)));
  return { configured, tested, agents };
}
