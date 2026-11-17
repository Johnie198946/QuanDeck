import path from 'node:path';
import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';

/** Validate a new project scope and reuse application settings. Handshake only: never probe, dispatch or copy policy. */
export function createProjectWorkspacePreparer({ records, profiles, testConnection, projects, directory = async value => {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error('请选择有效的项目文件夹');
  const canonical = await realpath(value);
  if (!(await stat(canonical)).isDirectory()) throw new Error('项目路径不是文件夹');
  return canonical;
} }) {
  return async (workspacePath, existing = {}, projectId, resolveAgentId) => {
    const canonical = await directory(workspacePath);
    const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
    // Existing-operation scopes are checked by the repository against immutable project directories.
    const collision = !resolveAgentId && (await projects()).find(snapshot => snapshot.project.id !== projectId && [snapshot.project.workspacePath, ...Object.values(snapshot.runtimeConnections ?? {}).map(binding => binding.projectPath)].some(value => value && normalize(value) === normalize(canonical)));
    if (collision) throw new Error(`此文件夹已用于项目「${collision.project.name}」，请选择独立文件夹`);
    // Creating a space only reserves its directory. No Agent process, handshake or conversation starts here.
    if(!resolveAgentId)return {workspacePath:canonical,bindings:{...existing},issues:[]};
    const selected = profiles(records());
    const bindings = { ...existing }, issues = selected.conflicts.filter(id => !resolveAgentId || id === resolveAgentId).map(id => `${id} 有多套旧配置，请在 Agent 设置中保存应用默认配置`);
    if (resolveAgentId && !selected.profiles.some(record => (record.agentId || record.tool) === resolveAgentId) && !selected.conflicts.includes(resolveAgentId)) issues.push('请先在 Agent 设置中保存这个 Agent 的应用默认配置');
    for (const record of selected.profiles) {
      const id = record.agentId || record.tool;
      if (resolveAgentId && resolveAgentId !== id) continue;
      try {
        const input = { tool: record.tool, projectPath: canonical };
        for (const key of ['agentId', 'displayName', 'binary', 'nodePath', 'provider', 'model', 'dshModelSource']) if (record[key] !== undefined) input[key] = record[key];
        const profileRevision = createHash('sha256').update(JSON.stringify(input)).digest('hex');
        // A project binding is only a transport cache. Every new operation resolves the current app profile.
        if (bindings[id] && (!resolveAgentId || bindings[id].profileRevision === profileRevision)) continue;
        const receipt = await testConnection(input);
        if (resolveAgentId && JSON.stringify(profiles(records()).profiles.find(value => (value.agentId || value.tool) === id)) !== JSON.stringify(record)) throw new Error('应用 Agent 配置已改变，请重试本次操作');
        if (receipt.tool !== input.tool || (receipt.agentId || receipt.tool) !== id || typeof receipt.projectPath !== 'string' || normalize(receipt.projectPath) !== normalize(canonical) || typeof receipt.connectionId !== 'string' || !receipt.connectionId) throw new Error('连接返回的身份或目录不匹配');
        for (const key of ['binary', 'nodePath', 'provider', 'model']) if (input[key] && receipt[key] !== undefined && receipt[key] !== input[key]) throw new Error('连接参数与应用配置不匹配');
        if (JSON.stringify(input.dshModelSource ?? null) !== JSON.stringify(receipt.dshModelSource ?? null)) throw new Error('模型来源与应用配置不匹配');
        if (!receipt.capabilities || Object.values(receipt.capabilities).some(value => typeof value !== 'boolean')) throw new Error('连接能力回执无效');
        if (receipt.status !== 'ready' && !receipt.discussionOpen) throw new Error(receipt.note || '连接未就绪');
        bindings[id] = { profileRevision, connectionId: receipt.connectionId, tool: receipt.tool, projectPath: canonical, capabilities: receipt.capabilities, ...(receipt.protocol ? { protocol: receipt.protocol } : {}), ...(receipt.provider ? { provider: receipt.provider } : {}), ...(receipt.model ? { model: receipt.model } : {}) };
      } catch (error) {
        const reason=error instanceof Error ? error.message : '';
        const message=/login|signed.out|登录/i.test(reason) ? '登录已失效，请在 Agent 设置中重新登录' : /timeout|timed.out|超时/i.test(reason) ? '连接超时，请重试本次操作' : ['应用 Agent 配置已改变，请重试本次操作','连接返回的身份或目录不匹配','连接参数与应用配置不匹配','模型来源与应用配置不匹配','连接能力回执无效'].includes(reason) ? reason : '连接暂不可用，请到 Agent 设置中检测与修复';
        issues.push(`${record.displayName || record.tool}：${message}`);
      }
    }
    return { workspacePath: canonical, bindings, issues };
  };
}
