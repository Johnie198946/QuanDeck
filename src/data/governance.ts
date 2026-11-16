import { hashText, projectActiveCalls } from './collaboration';
import type { CollaborationState, CollaborationTask } from './collaboration';
import type { Snapshot } from './types';

/** The desktop trust boundary supplies this identity; it is never accepted from AI JSON. */
export const LOCAL_PRINCIPAL = 'local-user';
export interface ProjectMember { principalId: string; role: 'owner' | 'editor' | 'reader'; active: boolean; version: number }
export interface ArtifactGrant {
  id: string; version: number; principalId: string; targetProjectId: string;
  artifactIds: string[]; createdAt: string; expiresAt: string; revokedAt?: string;
}
export interface ArtifactReadToken {
  digest: string; sourceProjectId: string; targetProjectId: string; principalId: string;
  grantId: string; grantVersion: number; runId: string; claimEpoch: number;
  specRevision: number; expiresAt: string; revokedAt?: string;
}
export interface AutomationPolicy {
  enabled: boolean; autoStart: false; taskKeys: string[]; maxNewTasks: number;
  specRevisions: Record<string, number>; adoptedPlanHashes: string[];
  /** Cumulative for this project, never reset by toggling a policy. */
  createdTaskIds: string[]; version: number;
}
export interface GovernanceState {
  schema: 1; ownerId: string; migratedAt: string; members: Record<string, ProjectMember>;
  grants: Record<string, ArtifactGrant>; readTokens: Record<string, ArtifactReadToken>;
  automation: AutomationPolicy;
  reads?: GrantedReadReceipt[];
  invalidReads?: Record<string, {at: string; reason: string}>;
}
export interface GrantedReadReceipt {
  id: string; sourceProjectId: string; artifactId: string; artifactHash: string;
  targetProjectId: string; principalId: string; grantId: string; grantVersion: number;
  runId: string; claimEpoch: number; offset: number; characters: number; fragmentHash: string; at: string;
}
function deny(code: string, message: string): never { throw Object.assign(new Error(message), { code }); }
const bounded = (value: unknown, name: string, max = 200): string =>
  typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : deny('SCHEMA_INVALID', name + '无效');
const integer = (value: unknown, min: number, max: number): number =>
  Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : deny('SCHEMA_INVALID', '数值超出范围');
export function ensureGovernance(c: CollaborationState): GovernanceState {
  return c.governance ??= {
    schema: 1, ownerId: LOCAL_PRINCIPAL, migratedAt: new Date().toISOString(),
    members: { [LOCAL_PRINCIPAL]: { principalId: LOCAL_PRINCIPAL, role: 'owner', active: true, version: 1 } },
    grants: {}, readTokens: {},
    automation: { enabled: false, autoStart: false, taskKeys: [], maxNewTasks: 20, specRevisions: {}, adoptedPlanHashes: [], createdTaskIds: [], version: 1 },
  };
}
export function assertProjectRole(c: CollaborationState, principalId: string, roles: ProjectMember['role'][]): void {
  const member = ensureGovernance(c).members[principalId];
  if (!member?.active || !roles.includes(member.role)) deny('FORBIDDEN', '当前身份没有项目操作权限');
}
export function changeMember(c: CollaborationState, actor: string, input: Record<string, unknown>): void {
  assertProjectRole(c, actor, ['owner']);
  const g = ensureGovernance(c), principalId = bounded(input.principalId, '成员身份');
  if (principalId === g.ownerId) deny('OWNER_REQUIRED', '不能移除或降级项目所有者');
  if (!['reader', 'editor'].includes(String(input.role)) || typeof input.active !== 'boolean') deny('SCHEMA_INVALID', '成员角色无效');
  g.members[principalId] = { principalId, role: input.role as 'reader' | 'editor', active: input.active as boolean, version: (g.members[principalId]?.version ?? 0) + 1 };
  // Revoking then re-adding membership must never resurrect old capabilities.
  for (const grant of Object.values(g.grants)) if (grant.principalId === principalId && !grant.revokedAt) {
    grant.version++; grant.revokedAt = new Date().toISOString();
  }
  for (const token of Object.values(g.readTokens)) if (token.principalId === principalId) token.revokedAt = new Date().toISOString();
}
export function createArtifactGrant(source: Snapshot, actor: string, input: Record<string, unknown>): ArtifactGrant {
  const c = source.collaboration!; assertProjectRole(c, actor, ['owner']);
  const principalId = bounded(input.principalId, '读取身份'), targetProjectId = bounded(input.targetProjectId, '目标项目');
  assertProjectRole(c, principalId, ['owner', 'editor', 'reader']);
  if (targetProjectId === source.project.id) deny('SCHEMA_INVALID', '跨项目授权需要不同的目标项目');
  if (!Array.isArray(input.artifactIds) || !input.artifactIds.length || input.artifactIds.length > 100) deny('SCHEMA_INVALID', '请选择 1–100 个成果版本');
  const artifactIds = [...new Set((input.artifactIds as unknown[]).map(v => bounded(v, '成果版本')))];
  for (const artifactId of artifactIds) approvedArtifact(source, artifactId);
  const expiresAt = bounded(input.expiresAt, '过期时间');
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now() || Date.parse(expiresAt) > Date.now() + 366 * 86400000) deny('SCHEMA_INVALID', '授权有效期须在未来一年以内');
  const grant = { id: 'grant-' + crypto.randomUUID(), version: 1, principalId, targetProjectId, artifactIds, expiresAt, createdAt: new Date().toISOString() };
  ensureGovernance(c).grants[grant.id] = grant;
  return grant;
}
export function revokeArtifactGrant(c: CollaborationState, actor: string, grantId: string): void {
  assertProjectRole(c, actor, ['owner']); const grant = ensureGovernance(c).grants[grantId];
  if (!grant) deny('NOT_FOUND', '授权不存在');
  grant.version++; grant.revokedAt = new Date().toISOString();
}
function approvedArtifact(source: Snapshot, artifactId: string) {
  if (source.project.deletedAt) deny('FORBIDDEN', '来源项目已删除');
  const c = source.collaboration!, artifact = c.artifacts.find(a => a.id === artifactId);
  const fresh = (id: string, seen = new Set<string>()): boolean => {
    const value = c.artifacts.find(a => a.id === id);
    if (!value || seen.has(id) || ['stale', 'unknown'].includes(c.freshness[id]) || hashText(value.body) !== value.hash || (value.expiresAt && Date.parse(value.expiresAt) <= Date.now())) return false;
    return value.sourceIds.every(parent => fresh(parent, new Set([...seen, id])));
  };
  if (!artifact || artifact.legacy || !fresh(artifact.id)) deny('SOURCE_UNAVAILABLE', '成果不存在、完整性有误、已过期或未验收');
  const task = c.tasks[artifact.key];
  if (!task || task.archived || task.requiresRevalidation || task.status !== 'done' || task.acceptedArtifactId !== artifact.id) deny('SOURCE_UNAVAILABLE', '只能授权当前已验收且有效的成果版本');
  return artifact;
}
function liveRun(target: Snapshot, runId: string) {
  const c = target.collaboration, run = c?.runs[runId], task = run && c?.tasks[run.key];
  if (target.project.deletedAt || !run || !task || task.archived || task.activeRunId !== run.id || run.claimEpoch !== task.claimEpoch || run.specRevision !== task.specRevision || !['queued', 'running', 'waiting_input', 'waiting_permission'].includes(run.status) || Date.parse(run.leaseExpiresAt) <= Date.now()) deny('RUN_REVOKED', '执行已结束、失联或被接管');
  return run;
}
/** Caller must persist target atomically before returning the raw capability to the runtime. */
export function issueArtifactReadToken(source: Snapshot, target: Snapshot, input: {runId: string; grantId: string; ttlMs?: number}, principalId: string = LOCAL_PRINCIPAL): {token: string; expiresAt: string} {
  if (!source.collaboration || !target.collaboration) deny('NOT_FOUND', '项目尚未初始化');
  assertProjectRole(source.collaboration, principalId, ['owner', 'editor', 'reader']);
  assertProjectRole(target.collaboration, principalId, ['owner', 'editor']);
  const run = liveRun(target, input.runId), grant = ensureGovernance(source.collaboration).grants[input.grantId];
  if (!grant || grant.revokedAt || grant.principalId !== principalId || grant.targetProjectId !== target.project.id || Date.parse(grant.expiresAt) <= Date.now()) deny('GRANT_REVOKED', '跨项目授权无效');
  for (const artifactId of grant.artifactIds) approvedArtifact(source, artifactId);
  const token = crypto.randomUUID() + crypto.randomUUID(), digest = hashText(token);
  const expiresAt = new Date(Math.min(Date.now() + integer(input.ttlMs ?? 300000, 1000, 900000), Date.parse(grant.expiresAt), Date.parse(run.leaseExpiresAt))).toISOString();
  ensureGovernance(target.collaboration).readTokens[digest] = { digest, sourceProjectId: source.project.id, targetProjectId: target.project.id, principalId, grantId: grant.id, grantVersion: grant.version, runId: run.id, claimEpoch: run.claimEpoch, specRevision: run.specRevision, expiresAt };
  return { token, expiresAt };
}
/** Read only a pinned artifact fragment, never a whole source project or transcript. */
export function readGrantedArtifact(source: Snapshot, target: Snapshot, input: {token: string; artifactId: string; offset?: number; limit?: number}) {
  if (!target.collaboration || !source.collaboration || typeof input.token !== 'string') deny('FORBIDDEN', '读取凭证无效');
  const token = ensureGovernance(target.collaboration).readTokens[hashText(input.token)];
  if (!token || token.revokedAt || token.sourceProjectId !== source.project.id || token.targetProjectId !== target.project.id || Date.parse(token.expiresAt) <= Date.now()) deny('TOKEN_EXPIRED', '读取凭证已失效');
  const run = liveRun(target, token.runId);
  if (run.claimEpoch !== token.claimEpoch || run.specRevision !== token.specRevision) deny('RUN_REVOKED', '执行身份已变化');
  assertProjectRole(source.collaboration, token.principalId, ['owner', 'editor', 'reader']);
  assertProjectRole(target.collaboration, token.principalId, ['owner', 'editor']);
  const grant = ensureGovernance(source.collaboration).grants[token.grantId];
  if (!grant || grant.revokedAt || grant.version !== token.grantVersion || grant.principalId !== token.principalId || grant.targetProjectId !== target.project.id || Date.parse(grant.expiresAt) <= Date.now() || !grant.artifactIds.includes(input.artifactId)) deny('GRANT_REVOKED', '该成果版本未获有效授权');
  const artifact = approvedArtifact(source, input.artifactId), offset = integer(input.offset ?? 0, 0, artifact.body.length), limit = integer(input.limit ?? 2000, 1, 8000);
  return { sourceProjectId: source.project.id, artifactId: artifact.id, hash: artifact.hash, title: artifact.title, body: artifact.body.slice(offset, offset + limit), offset, nextOffset: offset + limit < artifact.body.length ? offset + limit : null, totalCharacters: artifact.body.length, runId: token.runId, grantId: grant.id, sourceRef: {id: artifact.id, uri: `quandeck://projects/${encodeURIComponent(source.project.id)}/artifacts/${encodeURIComponent(artifact.id)}`, title: artifact.title} };
}
/** Use inside target's atomic transaction, then return its bounded fragment to the runtime. */
export function readAndRecordGrantedArtifact(source: Snapshot, target: Snapshot, input: Parameters<typeof readGrantedArtifact>[2]) {
  const fragment = readGrantedArtifact(source, target, input), g = ensureGovernance(target.collaboration!), token = g.readTokens[hashText(input.token)];
  const receipt: GrantedReadReceipt = {id: 'read-' + hashText([token.digest, fragment.artifactId, fragment.offset, fragment.body.length].join(':')), sourceProjectId: source.project.id, targetProjectId: target.project.id, artifactId: fragment.artifactId, artifactHash: fragment.hash, principalId: token.principalId, grantId: token.grantId, grantVersion: token.grantVersion, runId: token.runId, claimEpoch: token.claimEpoch, offset: fragment.offset, characters: fragment.body.length, fragmentHash: hashText(fragment.body), at: new Date().toISOString()};
  g.reads ??= [];
  if (!g.reads.some(r => r.id === receipt.id)) g.reads.push(receipt);
  return fragment;
}
/** Revocation never rewrites history; it invalidates dependent current versions and live claims. */
export function reconcileGrantedSources(sources: Snapshot[], target: Snapshot): {invalidReadIds: string[]; staleArtifactIds: string[]} {
  const c = target.collaboration, g = c?.governance;
  if (!c || !g?.reads?.length) return {invalidReadIds:[], staleArtifactIds:[]};
  g.invalidReads ??= {};
  const newlyInvalid: string[] = [], invalidRuns = new Set<string>();
  for (const read of g.reads) {
    const source = sources.find(s => s.project.id === read.sourceProjectId);
    try {
      if (!source?.collaboration) deny('SOURCE_UNAVAILABLE', '来源项目不存在');
      assertProjectRole(source.collaboration, read.principalId, ['owner','editor','reader']);
      assertProjectRole(c, read.principalId, ['owner','editor']);
      const grant = source.collaboration.governance?.grants[read.grantId];
      if (!grant || grant.revokedAt || grant.version !== read.grantVersion || grant.principalId !== read.principalId || grant.targetProjectId !== target.project.id || !grant.artifactIds.includes(read.artifactId) || Date.parse(grant.expiresAt) <= Date.now()) deny('GRANT_REVOKED', '跨项目授权已撤销或过期');
      const artifact = approvedArtifact(source, read.artifactId);
      if (artifact.hash !== read.artifactHash) deny('SOURCE_CHANGED', '来源成果完整性已变化');
    } catch (error) {
      if (!g.invalidReads[read.id]) {
        g.invalidReads[read.id] = {at:new Date().toISOString(), reason:error instanceof Error?error.message:'来源授权无效'};
        newlyInvalid.push(read.id);
      }
    }
    if (g.invalidReads[read.id]) invalidRuns.add(read.runId);
  }
  const impacted = new Set(c.artifacts.filter(a => a.runId && invalidRuns.has(a.runId)).map(a => a.id));
  let changed = true;
  while (changed) { changed = false; for (const a of c.artifacts) if (!impacted.has(a.id) && a.sourceIds.some(id => impacted.has(id))) {impacted.add(a.id); changed=true;} }
  const staleArtifactIds: string[] = [];
  for (const id of impacted) {
    if (c.freshness[id] !== 'stale') { c.freshness[id] = 'stale'; staleArtifactIds.push(id); }
    const artifact=c.artifacts.find(a=>a.id===id)!, task=c.tasks[artifact.key];
    if (task?.acceptedArtifactId===id && !task.requiresRevalidation) {task.requiresRevalidation=true;task.version++;}
  }
  for (const runId of invalidRuns) {
    const run=c.runs[runId], task=run && c.tasks[run.key];
    if (run && task && task.activeRunId===runId && ['queued','running','waiting_input','waiting_permission'].includes(run.status)) {
      run.status='cancelled';run.error='跨项目资料授权失效'; delete task.activeRunId;task.claimEpoch++;task.version++;
      if (task.status==='running') {task.status='blocked';task.blockReason=run.error;}
    }
  }
  if (newlyInvalid.length || staleArtifactIds.length) c.events.push({id:'event-'+crypto.randomUUID(),sequence:++c.sequence,type:'cross_project_source_invalidated',actor:'service',at:new Date().toISOString(),detail:JSON.stringify({readIds:newlyInvalid,artifactIds:staleArtifactIds})});
  return {invalidReadIds:newlyInvalid,staleArtifactIds};
}
export function configureAutomation(c: CollaborationState, actor: string, input: Record<string, unknown>): void {
  assertProjectRole(c, actor, ['owner']);
  if (input.autoStart !== false) deny('MANAGER_ONLY', 'QuanDeck 只登记下一步，不自动执行 Agent 任务');
  if (typeof input.enabled !== 'boolean' || typeof input.autoStart !== 'boolean' || !Array.isArray(input.taskKeys) || input.taskKeys.length > 100 || !input.taskKeys.every(v => typeof v === 'string' && c.tasks[v] && !c.tasks[v].archived)) deny('SCHEMA_INVALID', '自动推进需要明确的项目任务范围');
  const old = ensureGovernance(c).automation, taskKeys = [...new Set(input.taskKeys as string[])];
  if (input.enabled && !taskKeys.length) deny('APPROVAL_REQUIRED', '请先选择授权自动推进的任务');
  const maxNewTasks = integer(input.maxNewTasks, 0, 100);
  if (maxNewTasks < old.createdTaskIds.length) deny('SCHEMA_INVALID', '新任务上限不能低于已经创建的数量');
  const specRevisions = {...old.specRevisions};
  for (const key of taskKeys) specRevisions[key] = c.tasks[key].specRevision;
  ensureGovernance(c).automation = { enabled: input.enabled as boolean, autoStart: false, taskKeys, maxNewTasks, specRevisions, adoptedPlanHashes: old.adoptedPlanHashes ?? [], createdTaskIds: old.createdTaskIds, version: old.version + 1 };
  c.policy.autoAdopt = input.enabled as boolean;
}
/** Manager-only ready list. This query never starts an Agent or schedules a worker. */
export function automationReadyQueue(snapshot: Snapshot): CollaborationTask[] {
  const c = snapshot.collaboration, p = c?.governance?.automation;
  if (!c || !p?.enabled || snapshot.project.deletedAt) return [];
  const slots = Math.max(0, c.policy.maxParallel - projectActiveCalls(snapshot));
  const scope = new Set([...p.taskKeys, ...p.createdTaskIds]);
  return Object.values(c.tasks).filter(t => scope.has(t.key) && p.specRevisions?.[t.key] === t.specRevision && t.owner === 'agent' && t.status === 'ready' && !t.activeRunId && !t.archived && !t.blockReason && !t.requiresRevalidation && Object.values(c.runs).filter(r => r.key === t.key).length < c.policy.maxAttempts && !Object.values(c.externalActions).some(a => a.key === t.key && ['unknown', 'dispatched'].includes(a.status)) && t.dependencies.every(key => {
    const dep = c.tasks[key], artifact = c.artifacts.find(a => a.id === dep?.acceptedArtifactId);
    return dep?.status === 'done' && !dep.legacyCompletion && !dep.requiresRevalidation && artifact && !artifact.legacy && c.freshness[artifact.id] !== 'stale' && (!artifact.expiresAt || Date.parse(artifact.expiresAt) > Date.now());
  })).sort((a, b) => a.key.localeCompare(b.key)).slice(0, slots);
}
