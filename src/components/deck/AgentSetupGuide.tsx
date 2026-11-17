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
    <div className="qd-setup-instruction"><span className="qd-setup-number">2</span><div><h3>{guide.id === "dsh" ? "在 DSH 中完成配置" : "打开并登录"}</h3><p>{guide.id === "dsh" ? "打开已有的 DSH，在源工具中完成模型和账号配置。可以先发送一条消息确认可用，无需记录或在 QuanDeck 填写模型 ID。" : guide.id === "opencode" ? "启动后输入 /connect，选择模型服务并完成认证。" : guide.login ? "运行下面的命令，按照工具里的提示完成登录。" : "在源工具中完成登录，然后选定你的项目。"}</p>{guide.login && <CopyCommand key={`${guide.id}-login`} command={guide.login} />}{guide.id === "dsh" && <p>QuanDeck 自动使用 DSH 的配置，模型与凭据继续由 DSH 管理。<a className="qd-link" href="https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md" target="_blank" rel="noreferrer">模型配置说明 ↗</a></p>}</div></div>
    {guide.check && <div className="qd-setup-instruction"><span className="qd-setup-number">3</span><div><h3>确认工具可用</h3><p>重新打开终端，能看到版本号后继续配置项目。</p><CopyCommand key={`${guide.id}-check`} command={guide.check} /></div></div>}
    <p className="qd-connection-note">{guide.connection}</p>
    {guide.source && <a className="qd-link" href={guide.id === "workbuddy" && os === "windows" ? guide.source.replace("Installation-Mac-Guide", "Installation-Win-Guide") : guide.source} target="_blank" rel="noreferrer">查看 {guide.name} 官方安装说明 ↗</a>}
    <details className="qd-setup-screenshots"><summary>查看图文操作教程</summary><p>以下为配置页面实拍。安装和登录在源工具中完成。</p><figure><img src={`/tutorial/guide-${guide.id}-${os}.png`} alt="配置 Agent 弹窗，左侧选择工具，右侧按 macOS 或 Windows 查看安装和登录步骤" loading="lazy" /><figcaption>先选工具和操作系统，按步骤完成安装与登录。</figcaption></figure><figure><img src={guide.id === "dsh" ? "/tutorial/dsh-cli-project.png" : "/tutorial/02-local-project.png"} alt="本地连接设置，选择 CLI 文件与项目目录" loading="lazy" /><figcaption>打开应用的 Agent 配置。自动检测失败时，选择已安装的 CLI 文件；创建项目时再选择项目文件夹。</figcaption></figure><p>测试后查看连接状态和实际能力。保存一次应用配置，所有项目共享；创建项目时只需选择文件夹，任务在你发起后才执行。</p></details>
  </div>;
}
