import type { AgentIncident } from '../../integration/contracts';

const COPY: Record<string, { title: string; next: string }> = {
  fallback: { title: '启动前已换用备用 Agent', next: '主工具未能通过检查，任务已交给你预先选定的备用工具。' },
  login: { title: '需要重新登录', next: '打开 Agent 完成登录，再检查一次连接。' },
  quota: { title: '可用额度不足', next: '补充额度，或把任务交给备用 Agent。' },
  rate_limit: { title: 'Agent 暂时忙不过来', next: '稍后再检查，或选择备用 Agent。' },
  network: { title: '暂时连不上 Agent', next: '检查网络，再检测连接。已收到的记录仍然保留。' },
  model: { title: '当前模型暂时不可用', next: '在连接设置中更换模型，或选择备用 Agent。' },
  installation: { title: '找不到 Agent 程序', next: '检查程序是否已安装，并重新选择程序位置。' },
  project: { title: '暂时打不开项目文件夹', next: '确认文件夹仍在本机，并允许 Agent 访问。' },
  process: { title: 'Agent 已意外退出', next: '检查连接后，可以把已收到的进展交给另一位 Agent。' },
  unknown_acceptance: { title: '还不能确认任务是否已开始', next: '先查看原会话。确认前不会重发或自动转交。' },
  protocol: { title: '这个版本暂时无法协作', next: '检查连接设置中的版本与支持能力。' },
  suspected_stall: { title: '这项任务有一阵子没更新了', next: 'Agent 可能仍在处理。先查看会话，也可以继续等待。' },
  unknown: { title: '任务需要你看一下', next: '查看会话，或重新检查 Agent 的连接。' },
};
export function incidentCopy(incident: Pick<AgentIncident, 'code' | 'status'>) {
  if (incident.code === 'fallback') return COPY.fallback;
  if (incident.status === 'resolved') return { title: '已重新收到进展', next: '此提醒已解除，任务继续按源端状态更新。' };
  return COPY[incident.code] || COPY.unknown;
}
export function lastSeenLabel(value?: string, now = Date.now()) {
  if (!value || !Number.isFinite(Date.parse(value))) return '尚未收到进展';
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
  if (seconds < 60) return '刚刚更新';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前更新`;
  return `${Math.floor(seconds / 3600)} 小时前更新`;
}
