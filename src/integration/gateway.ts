import type { ConnectionInput, ConnectionTest, ConnectionHealth, FallbackPolicy, ManagedConnection, GatewaySettings, InteractionRequest, InteractionResult, SourceOpenRequest, SourceOpenResult, ToolDetection, ToolId } from "./contracts";
import type { RuntimeRunView } from "./desktop";
export type { SourceReference } from "./contracts";

const KEY = "quandeck.gateway.session.v1";
const DEFAULT: GatewaySettings = { baseUrl: "http://127.0.0.1:4175", token: "" };
const CONNECTIONS_KEY = "quandeck.gateway.connections.v1";
export function getTestedConnections(): ConnectionTest[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(CONNECTIONS_KEY) || "[]");
    return Array.isArray(value) ? value.filter((entry) => entry && typeof entry.tool === "string" && typeof entry.projectPath === "string" && entry.capabilities && typeof entry.capabilities === "object") : [];
  } catch { return []; }
}
export function saveTestedConnection(connection: ConnectionTest) {
  sessionStorage.setItem(CONNECTIONS_KEY, JSON.stringify([...getTestedConnections().filter((c) => c.connectionId !== connection.connectionId && (c.agentId || connection.agentId ? c.agentId !== connection.agentId || c.projectPath !== connection.projectPath : c.tool !== connection.tool || c.projectPath !== connection.projectPath)), connection]));
  window.dispatchEvent(new CustomEvent("quandeck:gateway-tested", { detail: connection }));
}
export function removeTestedConnection(tool: ToolId, projectPath: string, connectionId?: string) {
  sessionStorage.setItem(CONNECTIONS_KEY, JSON.stringify(getTestedConnections().filter((entry) => connectionId ? entry.connectionId !== connectionId : entry.tool !== tool || entry.projectPath !== projectPath)));
  window.dispatchEvent(new Event("quandeck:gateway-tested"));
}
export function getGatewaySettings(): GatewaySettings {
  try { return { ...DEFAULT, ...JSON.parse(sessionStorage.getItem(KEY) || "{}") }; } catch { return { ...DEFAULT }; }
}
export function validateGatewayUrl(value: string) {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/") throw new Error("连接地址只填写服务地址与端口");
  if (!(u.protocol === "https:" || (u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)))) throw new Error("本机使用 HTTP；远程服务需要 HTTPS");
  return u.origin;
}
export function saveGatewaySettings(settings: GatewaySettings) {
  const value = { baseUrl: validateGatewayUrl(settings.baseUrl), token: settings.token.trim() };
  const previous = getGatewaySettings();
  if (previous.baseUrl !== value.baseUrl || previous.token !== value.token) sessionStorage.removeItem(CONNECTIONS_KEY);
  sessionStorage.setItem(KEY, JSON.stringify(value));
  window.dispatchEvent(new Event("quandeck:gateway-settings"));
}
/** The provider is injectable for hosts with their own authenticated business backend. */
export function createGateway(getSettings = getGatewaySettings, fetcher: typeof fetch = (input, init) => fetch(input, init)) {
  async function request<T>(path: string, body?: unknown): Promise<T> {
    const settings = getSettings();
    if (!settings.token) throw new Error("请先在连接 Agent 中填写本地连接服务的配对码");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetcher(`${validateGatewayUrl(settings.baseUrl)}${path}`, {
        method: body === undefined ? "GET" : "POST", signal: controller.signal,
        headers: { Authorization: `Bearer ${settings.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || (response.status === 401 ? "连接凭证已失效，请重新连接" : response.status >= 500 ? "连接服务暂时没有响应，请稍后再试" : "这次操作未能完成，请检查连接设置"));
      return json as T;
    } catch (error) {
      if (error instanceof TypeError) throw new Error("无法连接本地服务，请确认已启动连接服务和地址正确");
      if (error instanceof Error && error.name === "AbortError") throw new Error("连接超时，请重试");
      throw error;
    } finally { clearTimeout(timeout); }
  }
  return {
    detectTools: () => request<{ tools: ToolDetection[] }>("/v1/tools"),
    openDiscussion: (input: { connectionId: string; prompt: string }) => request<{ status: "opened" | "unavailable"; message: string; needsPaste?: boolean }>("/v1/discussions/open", input),
    testConnection: (input: ConnectionInput) => request<ConnectionTest>("/v1/connections/test", input),
    checkHealth: (connectionId: string) => request<ConnectionHealth>("/v1/connections/health", { connectionId }),
    listConnections: () => request<{ connections: ManagedConnection[] }>("/v1/connections"),
    saveFallbackPolicy: (connectionId: string, policy: FallbackPolicy) => request<FallbackPolicy>("/v1/connections/policy", { connectionId, ...policy }),
    listRuntimeRuns: () => request<{ runs: RuntimeRunView[] }>("/v1/runtime/runs"),
    async openSource(input: SourceOpenRequest): Promise<SourceOpenResult> {
      if (input.mode === "sample") return { status: "unavailable", message: "这是示例会话。连接真实项目后，可在这里打开对应 Agent 会话。" };
      if (!input.connectionId || !input.tool) return { status: "unavailable", message: "源端尚未同步连接标识，无法准确打开这次会话" };
      return request<SourceOpenResult>("/v1/source/open", input);
    },
    /** Reserved for a backend that owns the live request. This UI replies in the source tool. */
    respond: (input: InteractionRequest) => request<InteractionResult>("/v1/interactions/respond", input),
  };
}
export const gateway = createGateway();
