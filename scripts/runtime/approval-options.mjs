/** Source-owned permission choices. QuanDeck never stores an automatic grant policy. */
const commandMethod = 'item/commandExecution/requestApproval';
const fileMethod = 'item/fileChange/requestApproval';
const validPrefix = value => Array.isArray(value) && value.length > 0 && value.every(part => typeof part === 'string' && part.length > 0);
const validNetwork = value => value && typeof value.host === 'string' && value.host.length > 0 && ['allow', 'deny'].includes(value.action);
const describe = (decision, kind) => {
  if (decision === 'accept') return { label: '允许本次', scope: 'once', description: '只批准当前操作。' };
  if (decision === 'acceptForSession') return { label: '在此会话中允许', scope: 'session', description: '由源 Agent 在当前会话记住适用的授权；新任务会话或不同权限仍可能询问。' };
  if (decision === 'decline') return { label: '拒绝', scope: 'deny', description: '不批准当前操作。' };
  if (decision === 'cancel') return { label: '取消本轮', scope: 'cancel', description: '向源 Agent 发送取消决定。' };
  if (kind === 'command' && decision && typeof decision === 'object') {
    const prefix = decision.acceptWithExecpolicyAmendment?.execpolicy_amendment;
    if (Object.keys(decision).length === 1 && validPrefix(prefix)) return { label: '记住这条命令规则', scope: 'rule', description: '将源端提出的规则交给 Codex 保存；以后匹配该规则的命令按源端策略处理。', rule: prefix.map(part => JSON.stringify(part)).join(' ') };
    const network = decision.applyNetworkPolicyAmendment?.network_policy_amendment;
    if (Object.keys(decision).length === 1 && validNetwork(network)) return { label: network.action === 'allow' ? '记住此网站的允许规则' : '记住此网站的拒绝规则', scope: 'rule', description: '只应用到源端提出的网站；规则由 Codex 管理。', rule: `${network.action}: ${network.host}` };
  }
  return null;
};

function permissionDetails(profile) {
  const lines = [], fs = profile.fileSystem, network = profile.network;
  if (network) {
    if (Object.keys(network).some(key => key !== 'enabled') || ![true, false, null].includes(network.enabled)) return null;
    if (network.enabled != null) lines.push(network.enabled ? '网络：允许连接' : '网络：不增加连接权限');
  }
  if (fs) {
    if (Object.keys(fs).some(key => !['read', 'write', 'entries', 'globScanMaxDepth'].includes(key))) return null;
    for (const [key, label] of [['read', '读取'], ['write', '写入']]) {
      if (fs[key] != null && (!Array.isArray(fs[key]) || !fs[key].every(path => typeof path === 'string' && path))) return null;
      for (const path of fs[key] || []) lines.push(`${label}：${path}`);
    }
    if (fs.entries != null && !Array.isArray(fs.entries)) return null;
    for (const entry of fs.entries || []) {
      const access = ['read', 'write', 'deny'].includes(entry?.access) ? { read: '读取', write: '写入', deny: '禁止访问' }[entry.access] : null, p = entry?.path;
      if (!access || !p || Object.keys(entry).some(key => !['path', 'access'].includes(key))) return null;
      let path = p.type === 'path' ? p.path : p.type === 'glob_pattern' ? p.pattern : null;
      if (p.type === 'special') {
        const value = p.value;
        const special = { root: '整个文件系统', minimal: '最小运行环境', project_roots: '项目目录', tmpdir: '系统临时目录', slash_tmp: '/tmp' }[value?.kind];
        path = special || (value?.kind === 'unknown' && value.path);
        if (path && value.subpath) path += ` / ${value.subpath}`;
      }
      if (typeof path !== 'string' || !path) return null;
      lines.push(`${access}：${path}`);
    }
    if (fs.globScanMaxDepth != null) {
      if (!Number.isSafeInteger(fs.globScanMaxDepth) || fs.globScanMaxDepth < 0) return null;
      lines.push(`目录匹配最大深度：${fs.globScanMaxDepth}`);
    }
  }
  return lines.length ? lines.join('\n') : null;
}

export function approvalChoices(tool, method, params = {}) {
  if (tool === 'codex' && method === 'item/permissions/requestApproval') {
    const profile = params.permissions;
    const deny = { id: 'deny', label: '拒绝', scope: 'deny', description: '不授予这次申请的额外权限。', response: { permissions: {}, scope: 'turn' } };
    if (!profile || typeof profile !== 'object' || Array.isArray(profile) || Object.keys(profile).some(key => !['network', 'fileSystem'].includes(key))) return [deny];
    const permissions = Object.fromEntries(Object.entries(profile).filter(([, value]) => value != null));
    if (!Object.keys(permissions).length || Object.values(permissions).some(value => typeof value !== 'object' || Array.isArray(value))) return [deny];
    const detail = permissionDetails(permissions);
    if (!detail) return [deny];
    return [
      { id: 'turn', label: '本轮使用这些权限', scope: 'turn', description: '仅把下方申请的权限授予当前一轮执行。', detailLabel: '查看申请的权限范围', rule: detail, response: { permissions, scope: 'turn' } },
      { id: 'session', label: '在此会话中允许', scope: 'session', description: '把同一组权限授予当前源会话；不扩展到其他任务会话。', detailLabel: '查看申请的权限范围', rule: detail, response: { permissions, scope: 'session' } },
      deny,
    ];
  }
  if (tool === 'codex' && [commandMethod, fileMethod].includes(method)) {
    const kind = method === commandMethod ? 'command' : 'file';
    // An explicit (including empty) source allow-list is authoritative. Older
    // App Servers omit it; the protocol's documented decisions are the fallback.
    let decisions = params.availableDecisions == null ? ['accept', 'acceptForSession', 'decline', 'cancel'] : Array.isArray(params.availableDecisions) ? params.availableDecisions : [];
    if (kind === 'command' && params.availableDecisions == null) {
      if (validPrefix(params.proposedExecpolicyAmendment)) decisions = [...decisions, { acceptWithExecpolicyAmendment: { execpolicy_amendment: params.proposedExecpolicyAmendment } }];
      for (const amendment of Array.isArray(params.proposedNetworkPolicyAmendments) ? params.proposedNetworkPolicyAmendments : []) if (validNetwork(amendment)) decisions = [...decisions, { applyNetworkPolicyAmendment: { network_policy_amendment: amendment } }];
    }
    return decisions.flatMap((decision, index) => {
      const description = describe(decision, kind);
      return description ? [{ id: `source-${index}`, ...description, response: { decision } }] : [];
    });
  }
  if (tool === 'codex') return [];
  // Other adapters have not verified session or persistent grants. Keep their
  // existing source contract instead of inventing cross-agent permission memory.
  return [
    { id: 'once', label: '允许本次', scope: 'once', description: '此 Agent 当前仅接入单次授权。', response: method === 'approval/request' ? { outcome: 'allowed-once' } : { decision: 'accept' } },
    { id: 'deny', label: '拒绝', scope: 'deny', description: '不批准当前操作。', response: method === 'approval/request' ? { outcome: 'rejected' } : { decision: 'decline' } },
    { id: 'cancel', label: '取消请求', scope: 'cancel', description: '向源 Agent 发送取消决定。', response: method === 'approval/request' ? { outcome: 'cancelled' } : { decision: 'cancel' } },
  ];
}

export function chooseApproval(choices, payload) {
  const legacyScope = { 'allowed-once': 'once', rejected: 'deny', cancelled: 'cancel' }[payload.decision];
  const choice = payload.approvalOptionId !== undefined
    ? choices.find(option => option.id === payload.approvalOptionId)
    : legacyScope && choices.find(option => option.scope === legacyScope);
  if (!choice) throw new Error('请明确选择源 Agent 本次提供的授权范围；过期或未提供的选项不能使用');
  return choice;
}

export const publicApprovalChoices = choices => choices.map(({ response, ...option }) => option);
