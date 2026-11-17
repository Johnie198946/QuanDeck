import type { Snapshot } from './types';
import { hashText } from './collaboration';
import { ensureIntegration, listIntegrationSources } from './resultIntegration';
import { parseDiscussionResponse } from './discussionPresentation';

export interface SpecAttachmentCandidate {
  id: string;
  artifactId: string;
  artifactHash: string;
  name: string;
  kind: 'output' | 'local';
  attachmentId?: string;
  outputId?: string;
  path?: string;
  runtimeRunId?: string;
  size?: number;
}
export interface SpecAttachmentPin {
  importId: string;
  candidateId: string;
  artifactId: string;
  artifactHash: string;
  name: string;
  kind: 'output' | 'local';
  attachmentId?: string;
  outputId?: string;
  /** Canonical path relative to the bound project, never an arbitrary URL. */
  path?: string;
  runtimeRunId?: string;
  fileHash: string;
  textHash: string;
  size: number;
}
export interface SpecAttachmentImport extends SpecAttachmentPin { body: string; at: string }
const textFile = (value: string) => /\.(md|txt)$/i.test(value);
const localLink = (value: string) => {
  if (!value || /[\x00-\x1f]/.test(value) || /^(?:https?:|data:|javascript:|\/\/|\\\\)/i.test(value)) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^file:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return false;
  try { return textFile(decodeURIComponent(value)); } catch { return false; }
};

/** Only links already present in the immutable accepted artifact can request a local read. */
export function listSpecAttachmentCandidates(snapshot: Snapshot, artifactId: string): SpecAttachmentCandidate[] {
  const source = listIntegrationSources(snapshot).find(s => s.artifactId === artifactId);
  const artifact = snapshot.collaboration?.artifacts.find(a => a.id === artifactId);
  if (!source?.eligible || !artifact || snapshot.project.deletedAt) return [];
  const output: SpecAttachmentCandidate[] = [];
  const add = (value: Omit<SpecAttachmentCandidate, 'id' | 'artifactId' | 'artifactHash'>) => {
    const id = 'spec-file-' + hashText(JSON.stringify([artifactId, artifact.hash, value.kind, value.attachmentId ?? value.path]));
    if (!output.some(item => item.id === id)) output.push({ ...value, id, artifactId, artifactHash: artifact.hash });
  };
  for (const file of artifact.attachments ?? []) {
    const saved = artifact.outputId && snapshot.outputs?.[artifact.outputId]?.attachments?.find(a => a.id === file.id);
    if (saved && saved.name === file.name && saved.size === file.size && textFile(file.name))
      add({ kind: 'output', name: file.name, attachmentId: file.id, outputId: artifact.outputId, size: file.size });
  }
  if (!source.runtimeRunId) return output;
  const response = parseDiscussionResponse(artifact.body);
  const markdown = [response.content, response.conclusion?.summary, ...(response.conclusion?.cards.map(c => c.body) ?? [])].filter(Boolean).join('\n');
  // Exclude fenced examples; unsupported Markdown link forms stay manual text, never broaden access.
  const prose = markdown.replace(/```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~/g, '');
  const links = [...prose.matchAll(/!?\[([^\]\n]+)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g)]
    .map(match => ({ name: match[1], path: match[2] ?? match[3] }));
  for (const item of [...links, ...(response.conclusion?.attachments ?? []).map(a => ({ name: a.name, path: a.path ?? a.url ?? '' }))]) {
    if (localLink(item.path)) add({ kind: 'local', name: item.name.slice(0, 300), path: item.path, runtimeRunId: source.runtimeRunId });
  }
  return output;
}

export function specAttachmentPin(record: SpecAttachmentImport): SpecAttachmentPin {
  const { body: _body, at: _at, ...pin } = record;
  return pin;
}

/** Trusted native file reader only. Not part of renderer BUSINESS_COMMANDS. */
export function recordSpecAttachmentImport(snapshot: Snapshot, candidate: SpecAttachmentCandidate,
  input: { body: string; fileHash: string; size: number; path?: string }): SpecAttachmentImport {
  const current = listSpecAttachmentCandidates(snapshot, candidate.artifactId).find(item => item.id === candidate.id);
  if (!current || JSON.stringify(current) !== JSON.stringify(candidate)) throw new Error('规范附件来源已变化，请重新选择已验收成果');
  if (!/^[a-f\d]{64}$/.test(input.fileHash) || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > 300000 ||
      typeof input.body !== 'string' || !input.body.trim() || input.body.length > 100000 || input.body.includes('\0')) throw new Error('规范附件内容无效或超过限制');
  if (candidate.kind === 'local' && (!input.path || input.path.startsWith('/') || input.path.split(/[\\/]/).includes('..') || !textFile(input.path))) throw new Error('规范附件来源路径无效');
  const textHash = hashText(input.body);
  const importId = 'spec-import-' + hashText(JSON.stringify([candidate.id, input.fileHash, textHash, input.path]));
  const state = ensureIntegration(snapshot), records = state.attachmentImports ??= {};
  if (Object.prototype.hasOwnProperty.call(records, importId)) return structuredClone(records[importId]);
  const { id: candidateId, path: _path, ...identity } = candidate;
  const record: SpecAttachmentImport = { ...identity, importId, candidateId, fileHash: input.fileHash, textHash,
    size: input.size, ...(candidate.kind === 'local' ? { path: input.path } : {}), body: input.body, at: new Date().toISOString() };
  records[importId] = record;
  state.events.push({ id: crypto.randomUUID(), sequence: ++state.sequence, at: record.at, type: 'spec_attachment_imported', draftId: '', bundleId: '', detail: JSON.stringify(specAttachmentPin(record)) });
  return structuredClone(record);
}

/** A renderer cannot invent provenance: every pin must match a native import receipt. */
export function validateSpecAttachmentPins(snapshot: Snapshot, value: unknown, sourceIds: string[]): SpecAttachmentPin[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('规范附件来源格式无效');
  const seen = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.importId !== 'string' || seen.has(raw.importId)) throw new Error('规范附件回执无效');
    seen.add(raw.importId);
    const records = snapshot.integration?.attachmentImports;
    const imported = records && Object.prototype.hasOwnProperty.call(records, raw.importId) ? records[raw.importId] : undefined;
    if (!imported || !sourceIds.includes(imported.artifactId) || hashText(imported.body) !== imported.textHash) throw new Error('规范附件缺少有效导入回执或未选择对应来源');
    const expected = specAttachmentPin(imported);
    if (Object.keys(raw).length !== Object.keys(expected).length || Object.entries(expected).some(([key, val]) => raw[key] !== val)) throw new Error('规范附件来源指纹被修改');
    return structuredClone(expected);
  });
}

export function specAttachmentContext(pins: SpecAttachmentPin[] = []): string {
  return pins.length ? '\n规范附件来源（发布时固定；正文以本版本为准）：\n' + pins.map(pin => JSON.stringify({ name: pin.name, artifactId: pin.artifactId, importId: pin.importId, attachmentId: pin.attachmentId, outputId: pin.outputId, path: pin.path, runtimeRunId: pin.runtimeRunId, sha256: pin.fileHash, textHash: pin.textHash, bytes: pin.size })).join('\n') : '';
}
