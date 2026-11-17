/** Public incident vocabulary; never surface provider status codes or credentials as user copy. */
export const redactDiagnostic = value => String(value?.message || value || '').replace(/(?:(?<![\w-])sk-[\w-]{8,}|Bearer\s+\S+)/gi, '[redacted]').replace(/((?:api[_-]?key|token|password|secret|authorization)["']?\s*[=:]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]').replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@').slice(0, 1500);
const issues = {
  login: ['需要重新登录', 'Agent 的登录或访问凭据已失效。任务记录仍在，请重新登录后再试。', '重新登录'],
  quota: ['可用额度不足', '当前账户的额度不足，Agent 暂时无法继续。可以补充额度，或选择其他 Agent。', '选择备用 Agent'],
  rate_limit: ['当前请求较多', '模型服务暂时繁忙，请稍后重试。已完成的记录仍然保留。', '稍后重试'],
  network: ['暂时连不上模型', '连接中断了，任务记录仍在。网络恢复后可以继续处理。', '重新检测'],
  model: ['这个模型暂时不可用', '所选模型暂时无法使用。请检查模型配置，或选择其他 Agent。', '检查模型'],
  installation: ['找不到 Agent 程序', '程序路径可能已改变。请在连接设置中重新选择 Agent。', '检查连接'],
  project: ['项目目录无法访问', '请检查项目文件夹是否仍然存在，以及当前账户是否有权访问。', '检查目录'],
  process: ['Agent 意外退出', '执行已中断，已收到的记录仍在。可以检查原会话或安排其他 Agent。', '查看记录'],
  unknown_acceptance: ['还不能确认任务是否已接收', '请先查看原会话，确认是否已经开始。为避免重复执行，暂不自动重派。', '查看原会话'],
  protocol: ['连接方式需要调整', '当前工具的连接方式或版本尚未匹配。请检查连接配置。', '检查连接'],
  suspected_stall: ['一段时间没有新消息', 'Agent 可能仍在处理。你可以继续等待，或查看原会话；不会自动重派任务。', '查看原会话'],
  unknown: ['Agent 暂时无法继续', '执行遇到了问题，已收到的记录仍在。可以检查连接或查看原会话。', '查看记录'],
};
const authenticationCodes = new Set(['unauthenticated', 'not_authenticated', 'authentication_error', 'invalid_api_key', 'invalid_token', 'token_expired', 'expired_token', 'credentials_expired', 'invalid_grant', 'unauthorized', 'forbidden']);
/** Keep classification evidence across JSON-RPC without retaining arbitrary provider payloads. */
export function incidentMetadata(error) {
  const objects = [error, error?.data, error?.response, error?.error, error?.data?.error].filter(value => value && typeof value === 'object');
  let status, code;
  for (const value of objects) {
    for (const key of ['status', 'statusCode', 'httpStatus', 'httpStatusCode']) {
      const candidate = value[key];
      const number = typeof candidate === 'number' ? candidate : typeof candidate === 'string' && /^\d{3}$/.test(candidate) ? Number(candidate) : NaN;
      if (status === undefined && Number.isInteger(number) && number >= 100 && number <= 599) status = number;
    }
    for (const key of ['code', 'type']) {
      const candidate = typeof value[key] === 'string' ? value[key].toLowerCase() : '';
      if (!code && authenticationCodes.has(candidate)) code = candidate;
    }
  }
  // JSON-RPC code is not an HTTP status; use a valid HTTP code only as a fallback.
  if (status === undefined) for (const value of objects) {
    const candidate = value.code;
    const number = typeof candidate === 'number' ? candidate : typeof candidate === 'string' && /^\d{3}$/.test(candidate) ? Number(candidate) : NaN;
    if (Number.isInteger(number) && number >= 100 && number <= 599) { status = number; break; }
  }
  return { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) };
}
export function classifyIncident(error, forcedCode) {
  const metadata = incidentMetadata(error);
  const raw = String(error?.message || error || '');
  const code = forcedCode || ([401, 403].includes(metadata.status) || metadata.code ? 'login'
    : /受理.*未知|unknown.*accept/i.test(raw) ? 'unknown_acceptance'
    : /quota|insufficient.*(credit|balance|fund)|credit.*(exhaust|insufficient)|billing|额度|余额|欠费/i.test(raw) ? 'quota'
    : /unauthori[sz]ed|\bunauthenticated\b|not[\s_-]+authenticated|invalid.*(api.?key|token)|authentication[\s_-]*(error|failed|failure|required)|(?:access|refresh|auth|bearer|session)[\s_-]+token(?:[\s_-]+(?:has|is))?[\s_-]+(?:expired|revoked)|(?:expired|revoked)[\s_-]+(?:access|refresh|auth|bearer|session)[\s_-]+token|not.?logged|\b(?:401|403)\b|登录|凭据/i.test(raw) ? 'login'
    : /rate.?limit|too many requests|429/i.test(raw) ? 'rate_limit'
    : /model.*(not found|unavailable|not supported)|unknown model|模型.*(不可用|不存在)|503|502/i.test(raw) ? 'model'
    : /ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|network|socket|reconnecting|request timed out|fetch failed|connect.*(failed|timeout)|网络|连接.*(中断|超时)/i.test(raw) ? 'network'
    : /项目目录无法访问|项目文件夹/.test(raw) ? 'project'
    : /ENOENT|not found|无法启动|找不到.*(程序|CLI)/i.test(raw) ? 'installation'
    : /目录|directory|EACCES/i.test(raw) ? 'project'
    : /进程.*退出|process.*exit|连接已关闭/i.test(raw) ? 'process'
    : /protocol|协议|版本|SDK|Provider|Model ID/i.test(raw) ? 'protocol' : 'unknown');
  const [title, message, action] = issues[code] || issues.unknown;
  return { code, title, message, action };
}
export const defaultFallbackPolicy = () => ({ mode: 'ask', connectionIds: [] });
