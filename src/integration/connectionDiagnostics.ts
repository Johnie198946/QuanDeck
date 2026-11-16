import { TOOL_LABELS, type ToolId } from './contracts';

export type ConnectionStage = 'host' | 'handshake' | 'reply';
export interface ConnectionDiagnosis {
  stage: ConnectionStage;
  code: string;
  title: string;
  next: string;
}
export const CONNECTION_STAGE_LABELS: Record<ConnectionStage, string> = {
  host: '连接本机服务', handshake: '启动 CLI / SDK', reply: '等待模型回复',
};

/** Never return source stderr, configuration text, paths, tokens, or arbitrary errors. */
export function diagnoseConnection(stage: ConnectionStage, cause: unknown, tool: ToolId): ConnectionDiagnosis {
  const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  const result = (code: string, title: string, next: string, at = stage): ConnectionDiagnosis => ({ stage: at, code, title, next });
  if (/本地服务|配对码|配对信息|连接失败（40[13]）/.test(message) || stage === 'host')
    return result('LOCAL_SERVICE', '本机连接服务尚未就绪', '退出 QuanDeck 后重新打开。网页版请检查连接服务地址与本次配对码。', 'host');
  if (tool === 'workbuddy' && /WorkBuddy/.test(message))
    return result('WORKBUDDY_DESKTOP', 'WorkBuddy 客户端联动不可用', /仅支持 macOS/.test(message) ? '请手动打开客户端并粘贴讨论指令。' : '确认 WorkBuddy 已安装到“应用程序”文件夹，再重新检测。');
  if (tool === 'workbuddy' && /目录/.test(message))
    return result('PROJECT_ACCESS', '无法访问项目文件夹', '重新选择一个可访问的本机项目文件夹。');
  if (/仍有关联会话|仍在后台分析/.test(message))
    return result('CONNECTION_BUSY', '原连接仍有任务在使用', '先结束并归档关联会话，等待后台分析完成，再更换模型配置。');
  if (/保存失败|未保存|界面缓存|连接已被修改|项目连接已发生变化/.test(message))
    return result('CONNECTION_STORAGE', '连接保存未完成或界面需要刷新', '请重新打开 QuanDeck 核对当前连接。模型检测通过不代表配置已保存；不要重复派发任务。');
  if (/needs_login|请先在.*登录/.test(message))
    return result('SIGN_IN', 'Agent 尚未登录', '先在同一 Windows 用户下打开源 Agent 并完成登录，再回来测试。');
  if (/来源配置已变化|重新检查并选择模型来源/.test(message))
    return result('MODEL_SOURCE_CHANGED', '源模型配置已变化', '打开“使用已有模型配置”，重新读取并选择来源后再检测。');
  if (/快照|模型来源|模型配置含|模型条目无法|默认模型缺少/.test(message))
    return result('MODEL_SOURCE_UNSUPPORTED', '模型配置暂不能自动复用', '重新读取模型来源并查看原因。企业插件、动态配置或内联密钥需要由源工具管理员配置 SDK。');
  if (/默认模型|模型覆盖配置|SDK 模型配置/.test(message))
    return result('SDK_MODEL', '无法读取 DSH 的 SDK 默认模型', '打开“使用已有模型配置”，选择 DSH 桌面或网页的模型并检测；未找到可复用来源时，再检查 SDK 的模型路由。');
  if (/执行终端|CLI.*绝对路径|不是 Agent|Node.js 路径/.test(message))
    return result('CLI_PATH', '需要选择 Agent 自身的程序', 'CLI 路径请选择工具的实际程序文件；DSH Desktop 选择 dsh.cmd，Node 路径留空。');
  if (/包装器|--version|实际版本/.test(message))
    return result('CLI_LAUNCHER', 'CLI 启动入口或版本尚未验证', 'DSH Desktop 请在 Manage dsh Command 中 Install / Repair，再用新 PowerShell 运行 where.exe dsh 和 dsh --version。');
  if (/ENOENT|未在 PATH|未找到.*CLI|找不到.*程序/.test(message))
    return result('CLI_NOT_FOUND', '未找到可用的 CLI 程序', '重新选择实际存在的 CLI 文件；安装或修复命令后，请完全退出并重新打开 QuanDeck。');
  if (/目录|ENOTDIR|EACCES|EPERM/.test(message) && stage === 'handshake')
    return result('PROJECT_ACCESS', '程序或工作目录无法访问', '用“选择程序”和“选择文件夹”重新选择本机路径，确认当前 Windows 用户有访问权限。');
  if (/SDK 配置与版本|隔离检测|只读隔离|隔离.*配置|协议|unsupported/.test(message))
    return result(stage === 'reply' ? 'ISOLATION_UNSUPPORTED' : 'SDK_UNSUPPORTED', stage === 'reply' ? 'SDK 已启动，隔离检测未通过' : 'SDK 配置或协议未通过验证', tool === 'dsh' ? '核对 DSH 版本与 sdk profile。企业版请让管理员确认默认模型路由及 SDK 插件兼容；无需重装覆盖现有企业配置。' : '核对源 Agent 的 CLI 版本与系统分析能力，再重新测试。');
  if (/超时|timed? ?out|timeout/i.test(message))
    return result('TIMEOUT', stage === 'reply' ? 'SDK 已启动，模型回复超时' : '启动 CLI / SDK 超时', stage === 'reply' ? '在源 Agent 检查网络与模型可用性。当前检测等待约 60 秒，稍后手动重试。' : '先在新终端确认 CLI 能正常显示版本，再检查工作目录和本机服务。');
  if (stage === 'reply')
    return result('MODEL_REPLY', 'SDK 已启动，尚未收到有效回复', tool === 'dsh' ? '用“使用已有模型配置”检查桌面与 SDK 是否使用相同模型；已复用时，检查源工具的凭据、网关与网络，再重新检测。' : '在源 Agent 确认账号、默认模型与网络正常，然后重新测试。');
  return result('SDK_START', 'CLI / SDK 尚未成功启动', '检查 CLI 文件、工作文件夹与源 Agent 配置。可复制下面的诊断摘要继续排查。');
}

export function connectionDiagnosticReport(tool: ToolId, diagnosis: ConnectionDiagnosis, version?: string | null) {
  const safeVersion = version && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version) ? version : '未读取';
  return ['QuanDeck 连接诊断', `工具：${TOOL_LABELS[tool]}`, `${tool === 'workbuddy' ? '客户端' : 'CLI'} 版本：${safeVersion}`, `失败阶段：${tool === 'workbuddy' && diagnosis.stage === 'handshake' ? '检查 WorkBuddy 与项目' : CONNECTION_STAGE_LABELS[diagnosis.stage]}`, `诊断代码：${diagnosis.code}`, `说明：${diagnosis.title}`].join('\n');
}
