import { useState } from "react";
import type { AgentGuide, GuideOS } from "../../integration/agentGuides";
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return <div className="qd-install-command"><code>{command}</code><button type="button" className="qd-link" onClick={async () => { try { await navigator.clipboard.writeText(command); setCopied(true); setError(false); } catch { setError(true); } }}>{error ? "请选中文字复制" : copied ? "已复制" : "复制"}</button></div>;
}
export function AgentSetupGuide({ guide, os }: { guide: AgentGuide; os: GuideOS }) {
  return <div className="qd-setup-guide">
    <div className="qd-setup-instruction"><span className="qd-setup-number">1</span><div><h3>安装 {guide.name}</h3><p>{guide.installNote[os]}</p>{guide.install[os] && <CopyCommand key={`${guide.id}-${os}-install`} command={guide.install[os]} />}</div></div>
    <div className="qd-setup-instruction"><span className="qd-setup-number">2</span><div><h3>{guide.id === "dsh" ? "配置并验证模型" : "打开并登录"}</h3><p>{guide.id === "dsh" ? "运行 dsh web，在打开的页面进入 Settings → Models，保存 DeepSeek API Key。选中工作目录和模型，先在 DSH 中发送一条消息确认可用。记下该模型的 ID。" : guide.id === "opencode" ? "启动后输入 /connect，选择模型服务并完成认证。" : guide.login ? "运行下面的命令，按照工具里的提示完成登录。" : "在源工具中完成登录，然后选定你的项目。"}</p>{guide.login && <CopyCommand key={`${guide.id}-login`} command={guide.login} />}{guide.id === "dsh" && <p>默认 Provider ID 为 deepseek-official。自定义 Provider 还需在 DSH 的 sdk profile 中配置同名路由；QuanDeck 不复制或读取 API Key。<a className="qd-link" href="https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md" target="_blank" rel="noreferrer">模型配置说明 ↗</a></p>}</div></div>
    {guide.check && <div className="qd-setup-instruction"><span className="qd-setup-number">3</span><div><h3>确认工具可用</h3><p>重新打开终端，能看到版本号后继续配置项目。</p><CopyCommand key={`${guide.id}-check`} command={guide.check} /></div></div>}
    <p className="qd-connection-note">{guide.connection}</p>
    {guide.source && <a className="qd-link" href={guide.id === "workbuddy" && os === "windows" ? guide.source.replace("Installation-Mac-Guide", "Installation-Win-Guide") : guide.source} target="_blank" rel="noreferrer">查看 {guide.name} 官方安装说明 ↗</a>}
    <details className="qd-setup-screenshots"><summary>查看图文操作教程</summary><p>以下为配置页面实拍。安装和登录在源工具中完成。</p><figure><img src={`/tutorial/guide-${guide.id}-${os}.png`} alt="配置 Agent 弹窗，左侧选择工具，右侧按 macOS 或 Windows 查看安装和登录步骤" loading="lazy" /><figcaption>先选工具和操作系统，按步骤完成安装与登录。</figcaption></figure><figure><img src={guide.id === "dsh" ? "/tutorial/dsh-cli-project.png" : "/tutorial/02-local-project.png"} alt="本地连接设置，选择 CLI 文件与项目目录" loading="lazy" /><figcaption>打开“连接项目”。自动检测失败时，选择已安装的 CLI 文件；再选择项目目录。</figcaption></figure>{guide.id === "dsh" ? <figure><img src="/tutorial/dsh-model-test.png" alt="DSH 配置页，填写 Provider 和 Model ID 后测试连接，未验证时保存按钮不可用" loading="lazy" /><figcaption>填写真实 Provider / Model ID 后测试。只有返回有效连接标识，才能保存到本机。</figcaption></figure> : <figure><img src="/tutorial/03-connection-result.png" alt="真实本地 Codex 连接测试页面，分别列出登录验证和各项能力" loading="lazy" /><figcaption>测试后查看实际能力，保存配置后会出现在 Agent 列表。</figcaption></figure>}</details>
  </div>;
}
