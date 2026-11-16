import { useState } from 'react';
import { CopyCommand } from './AgentSetupGuide';

/** A Web GUI address is not a verified SDK connection. Never registers an Agent. */
export function DshWebSetup() {
  const [product, setProduct] = useState('');
  const [address, setAddress] = useState('');
  const [feedback, setFeedback] = useState('');
  let url = '', error = '';
  if (address.trim()) {
    try {
      const value = new URL(address.trim());
      if (!['http:', 'https:'].includes(value.protocol) || value.username || value.password || value.search || value.hash) throw new Error();
      url = value.href;
    } catch { error = '只填写 http(s) 地址、端口和路径，去掉登录参数、token 和 # 后的内容。'; }
  }
  const report = [
    'QuanDeck · 企业 DSH 接入信息',
    `产品／版本：${product.trim() || '待确认'}`,
    `Web 界面：${url || '待确认'}`,
    '所需接口：会话创建／续聊、执行事件、用量、子 Agent、问题与权限回执。',
    '请确认是否保留官方 dsh SDK stdio 协议；如保留，请提供 CLI 入口和 SDK 启动说明。',
    '如只提供 Web 服务，请提供该版本 API／WebSocket 文档、认证／配对方式和会话定位方式。',
    'PowerShell 是命令执行终端，不是 DSH 接口。请勿附 API Key、Cookie 或配对密钥。',
  ].join('\n');
  return <div className="qd-dsh-web-setup">
    <div className="qd-dsh-web-heading"><h3>连接企业 Web 版</h3><span>接口待确认</span></div>
    <p>PowerShell 用来执行命令。QuanDeck 需要连接 DSH 自身的 SDK 或服务接口。</p>
    <ol className="qd-dsh-connect-routes">
      <li><strong>保留官方 SDK</strong><p>找到该版本的 DSH 启动程序，切回“CLI / SDK”填写路径并验证。</p></li>
      <li><strong>只提供 Web 界面</strong><p>向管理员获取该版本的 API 文档、认证方式和会话接口；网页能打开不代表支持自动委派。</p></li>
    </ol>
    <label>产品名称 / 版本<input value={product} maxLength={160} onChange={event => { setProduct(event.target.value); setFeedback(''); }} placeholder="例如：超聚变 DSH，关于页面中的版本号" /></label>
    <label>Web 界面地址<input value={address} maxLength={2048} onChange={event => { setAddress(event.target.value); setFeedback(''); }} placeholder="http://127.0.0.1:端口" spellCheck={false} aria-invalid={!!error} aria-describedby={error ? 'qd-dsh-url-error' : undefined} /></label>
    {error && <p id="qd-dsh-url-error" className="qd-connection-error" role="alert">{error}</p>}
    <div className="qd-dsh-web-actions">
      {url && <a className="qd-btn" href={url} target="_blank" rel="noreferrer">打开 DSH ↗</a>}
      <button className="qd-btn" type="button" disabled={!url || !product.trim()} onClick={async () => { try { await navigator.clipboard.writeText(report); setFeedback('接入信息已复制，可发给管理员核对。'); } catch { setFeedback('复制失败，请从下面的接入信息中手动复制。'); } }}>复制接入信息</button>
    </div>
    {feedback && <p role="status">{feedback}</p>}
    <details><summary>接入信息</summary><pre>{report}</pre></details>
    <details><summary>如何找到 DSH 启动入口</summary><p>如果该客户端有 <strong>Manage dsh Command…</strong> 菜单，选择 <strong>Install / Repair</strong> 注册命令，重开 QuanDeck 后再检测。没有此菜单时，向管理员询问该版本的 CLI / SDK 入口；不要另装官方版覆盖企业配置。</p></details>
    <details><summary>Windows：检查是否包含独立 DSH 程序</summary><p>在运行 DSH 的电脑上打开 PowerShell，执行下面的只读查询。若没有输出，说明它不在当前 PATH 中，仍可向管理员询问实际安装入口。</p><CopyCommand command={'Get-Command dsh, deepseek-harness -CommandType Application -ErrorAction SilentlyContinue | Select-Object Name, Source'} /><p>不要把 powershell.exe 或 pwsh.exe 填入 CLI 路径。</p></details>
  </div>;
}
