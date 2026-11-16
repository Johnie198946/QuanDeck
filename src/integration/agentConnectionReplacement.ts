import type { WorkdeckDataSource } from '../data/repository';
import type { RuntimeCommands, RuntimeConnectionBinding } from '../data/runtimeContracts';
import type { ConnectionInput, ConnectionTest } from './contracts';
import { CONFIGURED_AGENTS_KEY, getConfiguredAgents, type ConfiguredAgent } from './configuredAgents';
import { desktopHost } from './desktop';
import { removeTestedConnection, saveTestedConnection } from './gateway';

type ReplacementApi = Pick<WorkdeckDataSource, 'listProjects'> & Partial<Pick<RuntimeCommands, 'bindRuntimeConnection'>>;
const changing = new Set<string>();
const conflict = () => new Error('连接已被修改或移除，请刷新后重试');
const connectionInput = (config: ConnectionInput): ConnectionInput => ({
  tool: config.tool, projectPath: config.projectPath,
  ...(config.binary ? { binary: config.binary } : {}), ...(config.nodePath ? { nodePath: config.nodePath } : {}),
  ...(config.provider ? { provider: config.provider } : {}), ...(config.model ? { model: config.model } : {}),
  ...(config.dshModelSource ? { dshModelSource: { ...config.dshModelSource } } : {}),
});
const currentConfig = (config: ConfiguredAgent) => {
  const current = getConfiguredAgents().find(value => value.id === config.id);
  if (!current || JSON.stringify(current) !== JSON.stringify(config)) throw conflict();
};

/** Compare-and-swap preferences, then publish to the renderer only after durable save. */
async function saveReplacement(config: ConfiguredAgent, next: ConfiguredAgent) {
  currentConfig(config);
  const expected = localStorage.getItem(CONFIGURED_AGENTS_KEY) ?? '[]';
  const value = JSON.stringify(getConfiguredAgents().map(item => item.id === config.id ? next : item));
  const host = desktopHost();
  if (host?.comparePreference) {
    if (!await host.comparePreference(CONFIGURED_AGENTS_KEY, expected, value)) throw conflict();
  } else {
    await host?.savePreference(CONFIGURED_AGENTS_KEY, value);
    if ((localStorage.getItem(CONFIGURED_AGENTS_KEY) ?? '[]') !== expected) throw conflict();
  }
  try { localStorage.setItem(CONFIGURED_AGENTS_KEY, value); }
  catch {
    // Publishing to the renderer is a separate storage boundary. Compensate the
    // durable preference before allowing the caller to restore the old binding.
    let restored = !host;
    try {
      if (host?.comparePreference) restored = await host.comparePreference(CONFIGURED_AGENTS_KEY, value, expected);
      else if (host && (localStorage.getItem(CONFIGURED_AGENTS_KEY) ?? '[]') === expected) { await host.savePreference(CONFIGURED_AGENTS_KEY, expected); restored = true; }
    } catch { restored = false; }
    if (!restored) throw Object.assign(new Error('连接已保存，但界面缓存更新失败；请重新打开 QuanDeck 核对当前连接'), { bindingCommitted: true });
    throw new Error('界面缓存保存失败');
  }
  window.dispatchEvent(new Event('quandeck:agent-configured'));
}

async function ownerOf(api: ReplacementApi, config: ConfiguredAgent) {
  currentConfig(config);
  if (!api.bindRuntimeConnection || !config.connectionId) throw new Error('请在桌面版中为原项目保存 Agent 连接后重试');
  const matches = (await api.listProjects()).flatMap(project => Object.entries(project.runtimeConnections ?? {})
    .filter(([, binding]) => binding.connectionId === config.connectionId && binding.tool === config.tool)
    .map(([agentId, binding]) => ({ projectId: project.project.id, agentId, binding })));
  if (matches.length !== 1) throw new Error('无法确定原连接所属项目，请先回到该项目检查 Agent 配置');
  currentConfig(config);
  return matches[0];
}

async function applyReplacement(api: ReplacementApi, config: ConfiguredAgent, next: ConfiguredAgent, binding: RuntimeConnectionBinding, expectedProject?: string) {
  if (changing.has(config.id)) throw new Error('正在更新此连接，请稍候');
  changing.add(config.id);
  try {
    const owner = await ownerOf(api, config);
    if (expectedProject && owner.projectId !== expectedProject) throw conflict();
    const bind = api.bindRuntimeConnection!.bind(api);
    const result = await bind(owner.agentId, binding, { projectId: owner.projectId, expectedConnectionId: owner.binding.connectionId });
    if (!result.ok) throw new Error(result.message || '项目连接更新失败，原配置保留');
    try { await saveReplacement(config, next); }
    catch (error) {
      if (error && typeof error === 'object' && 'bindingCommitted' in error) throw error;
      // A disk/CAS failure must restore the original binding, never report a saved repair.
      const rollback = await bind(owner.agentId, owner.binding, { projectId: owner.projectId, expectedConnectionId: binding.connectionId }).catch(() => ({ ok: false }));
      if (!rollback.ok) throw new Error('连接保存失败，项目连接已发生变化，请重新打开设置核对；未覆盖其他操作');
      throw new Error('连接未保存，已恢复原项目连接，请刷新后重试');
    }
    return next;
  } finally { changing.delete(config.id); }
}

/** Caller completes handshake and hello first; a failed test never enters this operation. */
export async function replaceConfiguredAgentConnection(api: ReplacementApi, config: ConfiguredAgent, receipt: ConnectionTest): Promise<ConfiguredAgent> {
  if (config.tool !== 'dsh' || receipt.tool !== 'dsh' || receipt.status !== 'ready' || !receipt.connectionId || !receipt.dshModelSource || receipt.projectPath !== config.projectPath || receipt.binary !== config.binary || receipt.nodePath !== config.nodePath) throw new Error('请先完成当前连接与模型来源的测试');
  const owner = await ownerOf(api, config);
  const binding: RuntimeConnectionBinding = { connectionId: receipt.connectionId, tool: receipt.tool, projectPath: receipt.projectPath, capabilities: receipt.capabilities, ...(receipt.protocol ? { protocol: receipt.protocol } : {}) };
  const next: ConfiguredAgent = {
    ...connectionInput(receipt), id: config.id, configuredAt: new Date().toISOString(), connectionId: receipt.connectionId,
    previousConnection: receipt.connectionId === config.connectionId ? config.previousConnection : { input: connectionInput(config), binding: owner.binding, projectId: owner.projectId },
  };
  const saved = await applyReplacement(api, config, next, binding, owner.projectId);
  saveTestedConnection(receipt);
  return saved;
}

/** Restores the previous identity/binding; it does not replay tasks or claim a fresh hello. */
export async function restoreConfiguredAgentConnection(api: ReplacementApi, config: ConfiguredAgent): Promise<ConfiguredAgent> {
  const previous = config.previousConnection;
  if (!previous || config.tool !== 'dsh' || previous.input.tool !== 'dsh' || previous.binding.tool !== 'dsh' || previous.input.projectPath !== config.projectPath || previous.binding.projectPath !== config.projectPath) throw new Error('没有可恢复的原连接');
  const next: ConfiguredAgent = { ...connectionInput(previous.input), id: config.id, configuredAt: new Date().toISOString(), connectionId: previous.binding.connectionId };
  const saved = await applyReplacement(api, config, next, previous.binding, previous.projectId);
  removeTestedConnection(config.tool, config.projectPath);
  return saved;
}
