/** Versioned companion contract. These identifiers come from source receipts, never UI labels. */
export type ToolId = "codex" | "claude" | "cursor" | "opencode" | "dsh";
export const TOOL_LABELS: Record<ToolId, string> = { codex: "Codex", claude: "Claude Code", cursor: "Cursor", opencode: "OpenCode", dsh: "DeepSeek Harness" };
export interface ConnectionInput {
  tool: ToolId;
  /** Optional user-named profile. The protocol still comes from tool, never the label. */
  displayName?: string;
  agentId?: string;
  projectPath: string;
  /** Absolute executable or JavaScript entry path. Omit to resolve the installed CLI. */
  binary?: string;
  nodePath?: string;
  /** Optional legacy overrides. New connections use the source tool configuration. */
  provider?: string;
  model?: string;
}
export type Capability = "observe" | "dispatch" | "resume" | "usage" | "subAgents" | "sourceOpen" | "permissions";
export interface ToolDetection {
  tool: ToolId;
  installed: boolean;
  binary?: string;
  version: string | null;
  login: "signed_in" | "signed_out" | "unknown";
  adapter: "available" | "unavailable";
  note: string;
}
export interface ConnectionTest extends ConnectionInput {
  /** Read-only SDK selection observed during this handshake; never an override. */
  sourceModel?: { provider: string; model: string };
  /** Version reported by the actual CLI, not the Web shell or SDK protocol server. */
  cliVersion?: string;
  protocol?: string;
  discussionOpen?: boolean;
  connectionId?: string;
  tool: ToolId;
  projectPath: string;
  status: "ready" | "needs_login" | "unsupported";
  login: ToolDetection["login"];
  capabilities: Record<Capability, boolean>;
  checkedAt: string;
  note: string;
}
export interface ConnectionProbe {
  status: "connected" | "failed";
  checkedAt: string;
  message: string;
}
export interface SourceReference {
  connectionId: string;
  tool: ToolId;
  sessionId: string;
  attemptId?: string;
  parentSessionId?: string | null;
  childSessionId?: string;
  /** Tool call anchor when the child does not have an independently resumable session. */
  childCallId?: string;
  /** Original approval/question identifier. Opening the source never acknowledges this request. */
  requestId?: string;
  sourceUrl?: string;
}
export type SourceOpenRequest = Partial<SourceReference> & { mode: "sample" | "live"; sessionId: string };
export interface SourceOpenResult {
  status: "opened" | "parent_opened" | "unavailable";
  message: string;
  targetSessionId?: string;
  requestId?: string;
  /** The client displays the anchor; it does not claim that the terminal scrolled to it. */
  childCallId?: string;
}
export interface InteractionRequest extends SourceReference {
  requestId: string;
  expectedRevision: string;
  response: { kind: "reply"; text: string } | { kind: "permission"; decision: "allow_once" | "deny" };
}
export interface InteractionResult { acknowledged: boolean; eventId?: string; message: string }
export interface GatewaySettings { baseUrl: string; token: string }

export interface FallbackPolicy {
  mode: "ask" | "auto_before_start";
  connectionIds: string[];
}
export interface ConnectionHealth {
  connectionId: string;
  status: "available" | "unavailable" | "unknown";
  checkedAt: string;
  expiresAt: string;
  checks: { key: "installation" | "project" | "protocol" | "login" | "model" | "quota"; status: "passed" | "failed" | "unknown"; message: string }[];
  issue?: { code: string; title: string; message: string; action: string };
  canStart: boolean;
}
export interface ManagedConnection extends ConnectionInput {
  connectionId: string;
  capabilities?: Partial<Record<Capability, boolean>>;
  health?: ConnectionHealth;
  fallbackPolicy: FallbackPolicy;
}
export interface AgentIncident {
  id: string;
  code: string;
  title: string;
  message: string;
  action?: string;
  detectedAt: string;
  status: "open" | "resolved";
  kind: "failure" | "attention";
  resolvedReason?: 'handed_off' | 'activity_resumed';
  resolvedAt?: string;
  successorRunId?: string;
}
