import type { Snapshot, OutputAttachment } from '../data/types';
import type { GatewaySettings, AgentIncident } from './contracts';

export interface OutputAttachmentVersion { versionId: string; artifactId: string; slotId: string }

export interface DesktopWindowState { maximized: boolean; fullscreen: boolean }
export interface ErasePreview {token:string;projectId:string;projectName:string;affectedProjectIds:string[];affectedProjects:{id:string;name:string}[];counts:{projects:number;tasks:number;artifacts:number;sessions:number;attachments:number};backupCount:number;expiresAt:string|number;fingerprint:string}

export interface RuntimeAttachment { name: string; path: string; size?: number }
export type AttachmentBlock = { kind: 'heading' | 'paragraph' | 'list'; text: string; level?: number } | { kind: 'table'; rows: string[][] };
export interface PreviewSheet { name: string; rows: { number: number; cells: { text: string; formula?: string }[] }[] }
export type RuntimeAttachmentPreview = RuntimeAttachment & { truncated?: boolean; note?: string } & (
  { kind: 'image' | 'video' | 'pdf'; mime: string; bytes: Uint8Array } |
  { kind: 'document'; blocks: AttachmentBlock[] } |
  { kind: 'spreadsheet'; sheets: PreviewSheet[] } |
  { kind: 'text'; text: string } |
  { kind: 'html'; html: string }
);
export interface DesktopHost {
  importSpecAttachment?(projectId: string, artifactId: string, candidateId: string): Promise<import('../data/specAttachments').SpecAttachmentImport>;
  previewDiscussionAttachment?(projectId:string,planId:string,conclusionId:string,blockId:string,optionId?:string):Promise<RuntimeAttachmentPreview>;
  previewOutputAttachment?(projectId: string, outputId: string, attachmentId: string, reference?: OutputAttachmentVersion): Promise<RuntimeAttachmentPreview>;
  chooseRunAttachments?(runId: string): Promise<RuntimeAttachment[]>;
  previewRunAttachment?(runId: string, path: string): Promise<RuntimeAttachmentPreview>;
  revealRunAttachment?(runId: string, path: string): Promise<void>;
  exportProject?(projectId:string):Promise<{sourceHash:string;projectId:string;generation:string;generatedAt:string;files:unknown}>;
  deleteProjectPermanently?(projectId:string):Promise<{erasedProjectIds:string[];restartRequired:boolean;externalCopies:string}|null>;
  previewEraseProject?(projectId:string):Promise<ErasePreview>;
  eraseProject?(input:{token:string;confirmation:string}):Promise<{erasedProjectIds:string[];restartRequired:boolean;externalCopies:unknown}|null>;
  restoreWorkspace?():Promise<{restartRequired:boolean;rollbackPoint:string;files:number;replayedErasureCount:number}|null>;
  comparePreference?(key: string, expected: string, value: string): Promise<boolean>;
  getWindowState?(): Promise<DesktopWindowState>;
  toggleFullscreen?(): Promise<void>;
  onWindowState?(listener: (state: DesktopWindowState) => void): () => void;
  platform: string;
  getConnection(): Promise<GatewaySettings>;
  agentSetupDirectory?(): Promise<string>;
  chooseDirectory(): Promise<string | null>;
  chooseExecutable(): Promise<string | null>;
  bootstrap(values: Record<string, string | null>): Promise<Record<string, string | null>>;
  command(name: string, args: unknown[]): Promise<unknown>;
  onStorageError(listener: (message: string) => void): () => void;
  onSnapshot(listener: (snapshot: Snapshot) => void): () => void;
  onProjectChanges?(listener: (change: { activeProjectId: string }) => void): () => void;
  onNavigate(listener: (target: { projectId: string; planId?: string; taskId?: string; itemId?: string; runId?: string; incidentId?: string; view?: "plan" | "tasks" | "results" }) => void): () => void;
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
  delivery?: import("../data/sessionDelivery").SessionDelivery;
  submissionIssue?: { code: string; message: string };
  workflow?: { conclusions?: {id:string; sourceMessageId?:string; summary:string; visualBlocks?:import("../data/discussionVisual").DiscussionVisualBlock[]; feedback?:import("../data/discussionVisual").DiscussionBlockFeedback[]}[]; planId: string; conclusionId?: string; approved: boolean; scope?: "project" | "task"; automationEnabled?: boolean; taskCount: number; draftVersion: number; adoptedVersion?: number; taskId: string; projectId: string };
  runId: string; sessionId?: string; tool?: string; title?: string; status?: string; projectPath?: string;
  connectionId?: string; agentId?: string; projectId?: string; taskId?: string; workItemId?: string; dispatchId?: string;
  acceptance?: 'acknowledged' | 'unknown' | 'rejected'; acceptedAt?: string;
  stoppedConfirmed?: boolean;
  contextRestart?: { available: boolean; reason: string };
  health?: { lastActivityAt?: string; incident?: AgentIncident };
  fallback?: { fromConnectionId: string; toConnectionId: string; reason: string; acceptanceNotSent: boolean };
  prompt?: string; tokens?: number; purpose?: 'discussion' | 'execution' | 'review';
  protocol?: string;
  controls?: { canResume: boolean; canReply: boolean; reason?: string };
  events: { id: string; at: string; targetSessionId?: string; status?: string; message?: { id: string; text: string; role?: string }; reply?: { id: string; text: string }; error?: string; notice?: string; incident?: AgentIncident; requestResolved?: string; childMessage?: { sessionId: string; text: string }; child?: { id: string; sessionId?: string; title: string; status: string; reply?: string }; step?: { label?: string }; tokens?: number; request?: RuntimeRequest }[];
  request?: RuntimeRequest;
}
export interface RuntimePermissionOption { id: string; label: string; scope: 'once'|'turn'|'session'|'rule'|'deny'|'cancel'; description: string; rule?: string; detailLabel?: string }
export interface RuntimeRequest { permissionOptions?: RuntimePermissionOption[]; permissionSource?: string; details?: string; targetSessionId?: string; id: string; kind: string; prompt: string; options?: unknown[]; questions?: { id: string; header?: string; question?: string; title?: string; options?: { label: string; description?: string }[] }[] }
export const desktopHost = () => (window as Window & { quandeckDesktop?: DesktopHost }).quandeckDesktop;
