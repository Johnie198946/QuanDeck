import type { Snapshot, OutputAttachment } from '../data/types';
import type { GatewaySettings, AgentIncident } from './contracts';

export interface DesktopWindowState { maximized: boolean; fullscreen: boolean }

export interface DesktopHost {
  comparePreference?(key: string, expected: string, value: string): Promise<boolean>;
  getWindowState?(): Promise<DesktopWindowState>;
  toggleFullscreen?(): Promise<void>;
  onWindowState?(listener: (state: DesktopWindowState) => void): () => void;
  platform: string;
  getConnection(): Promise<GatewaySettings>;
  chooseDirectory(): Promise<string | null>;
  chooseExecutable(): Promise<string | null>;
  bootstrap(values: Record<string, string | null>): Promise<Record<string, string | null>>;
  command(name: string, args: unknown[]): Promise<unknown>;
  onStorageError(listener: (message: string) => void): () => void;
  onSnapshot(listener: (snapshot: Snapshot) => void): () => void;
  onNavigate(listener: (target: { projectId: string; taskId?: string; runId?: string; incidentId?: string }) => void): () => void;
  savePreference(key: string, value: string): Promise<void>;
  saveAttachment(projectId: string, file: { name: string; type: string; bytes: ArrayBuffer }): Promise<OutputAttachment>;
  downloadAttachment(projectId: string, attachment: OutputAttachment): Promise<boolean>;
  removeAttachment(projectId: string, id: string): Promise<void>;
  openRun(runId: string, targetSessionId?: string): Promise<void>;
  getRun(runId: string): Promise<RuntimeRunView>;
  controlRun(runId: string, action: string, payload?: unknown): Promise<{ ok?: boolean; message?: string }>;
  onRunEvent(listener: (event: { runId: string }) => void): () => void;
  cleanInstallers(): Promise<{ removed: string[]; freedBytes: number }>;
  backupWorkspace(): Promise<{ directory: string; files: number } | null>;
}
export interface RuntimeRunView {
  runId: string; sessionId?: string; tool?: string; title?: string; status?: string; projectPath?: string;
  connectionId?: string; agentId?: string; projectId?: string; taskId?: string; workItemId?: string; dispatchId?: string;
  acceptance?: 'acknowledged' | 'unknown' | 'rejected'; acceptedAt?: string;
  stoppedConfirmed?: boolean;
  health?: { lastActivityAt?: string; incident?: AgentIncident };
  fallback?: { fromConnectionId: string; toConnectionId: string; reason: string; acceptanceNotSent: boolean };
  prompt?: string; tokens?: number;
  protocol?: string;
  controls?: { canResume: boolean; canReply: boolean; reason?: string };
  events: { id: string; at: string; targetSessionId?: string; status?: string; message?: { id: string; text: string; role?: string }; reply?: { id: string; text: string }; error?: string; notice?: string; requestResolved?: string; childMessage?: { sessionId: string; text: string }; child?: { id: string; sessionId?: string; title: string; status: string; reply?: string }; step?: { label?: string }; tokens?: number; request?: RuntimeRequest }[];
  request?: RuntimeRequest;
}
export interface RuntimeRequest { details?: string; targetSessionId?: string; id: string; kind: string; prompt: string; options?: unknown[]; questions?: { id: string; header?: string; question?: string; title?: string; options?: { label: string; description?: string }[] }[] }
export const desktopHost = () => (window as Window & { quandeckDesktop?: DesktopHost }).quandeckDesktop;
