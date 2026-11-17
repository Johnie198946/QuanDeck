import { TOOL_LABELS, type ConnectionInput } from './contracts';

export interface AgentProfileRecord extends ConnectionInput { scope?: 'application'; connectionId?: string; capabilities?:Record<string,boolean> }
/** Read legacy records without choosing conflicting profiles. Explicit application profiles take precedence. */
export function reusableAgentProfiles(value: unknown) {
  const records: AgentProfileRecord[] = Array.isArray(value) ? value.filter(record => record && Object.prototype.hasOwnProperty.call(TOOL_LABELS, record.tool) && typeof record.projectPath === 'string' && (!record.agentId || typeof record.agentId === 'string')) : [];
  const profiles: AgentProfileRecord[] = [], conflicts: string[] = [];
  const signature = (record: AgentProfileRecord) => JSON.stringify([record.tool, record.binary || '', record.nodePath || '', record.provider || '', record.model || '', record.dshModelSource?.profile || '', record.dshModelSource?.revision || '']);
  for (const id of new Set(records.map(record => record.agentId || record.tool))) {
    const group = records.filter(record => (record.agentId || record.tool) === id);
    const explicit = group.filter(record => record.scope === 'application');
    const candidates = explicit.length ? explicit : group;
    if (new Set(candidates.map(signature)).size > 1) { conflicts.push(id); continue; }
    if (candidates[0]) profiles.push(candidates[0]);
  }
  return { profiles, conflicts };
}

/** UI labels share the backend selector, so legacy compatibility never implies a required reconfiguration. */
export function applicationAgentProfileLabel(agentId:string,records:unknown):string {
  const selected=reusableAgentProfiles(records);
  if(selected.conflicts.includes(agentId))return '配置冲突 · 需选择一次应用配置';
  const profile=selected.profiles.find(value=>(value.agentId || value.tool)===agentId);
  if(!profile)return '尚未配置应用 Agent';
  return profile.scope==='application' ? '所有项目共享 · 新执行使用' : '所有项目共享 · 已兼容旧配置';
}

/** Read-only legacy/browser hints; native starts resolve current application settings before using a transport. */
export function projectDiscussionConnections(input: {
  agentId: string; tool?: import('./contracts').ToolId; workspacePath?: string;
  binding?: import('../data/runtimeContracts').RuntimeConnectionBinding;
  configured: AgentProfileRecord[]; tested: import('./contracts').ConnectionTest[]; native: boolean;
}): {connectionId: string; projectPath:string; tool:import('./contracts').ToolId; capabilities?:import('./contracts').ConnectionTest['capabilities']}[] {
  if (input.binding) return [input.binding];
  if (!input.tool) return [];
  const inScope=(record:AgentProfileRecord) => record.tool === input.tool && (record.agentId || record.tool) === input.agentId && (!input.workspacePath || record.projectPath === input.workspacePath);
  const validationIds=new Set(input.configured.filter(record=>record.scope==='application').map(record=>record.connectionId));
  const validationPaths=new Set(input.configured.filter(record=>record.scope==='application').map(record=>record.projectPath));
  if(input.tool==='workbuddy' && input.native) return input.configured.filter(record=>record.scope!=='application' && inScope(record) && !!record.connectionId).map(record=>({connectionId:record.connectionId!,projectPath:record.projectPath,tool:record.tool}));
  return input.tested.filter(record=>inScope(record) && record.discussionOpen && record.connectionId && !validationIds.has(record.connectionId) && !validationPaths.has(record.projectPath)).map(record=>({...record,connectionId:record.connectionId!}));
}

/** A verified global profile can be preflighted in any project, including old receipts without cached capabilities. */
export function canAttemptAgentDispatch(profile:AgentProfileRecord|undefined, binding?:import('../data/runtimeContracts').RuntimeConnectionBinding, tested?:import('./contracts').ConnectionTest) {
  if(profile) {
    if(profile.tool==='workbuddy')return false;
    const capability=(profile.capabilities ?? tested?.capabilities)?.dispatch;
    return !!profile.connectionId && capability!==false;
  }
  return binding?.capabilities?.dispatch===true;
}
