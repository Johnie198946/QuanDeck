import type { ToolId } from "../../integration/contracts";
import type { GuideOS } from "../../integration/agentGuides";
import { CopyCommand } from "./AgentSetupGuide";

const PROTOCOLS: [ToolId, string][] = [["hermes", "Hermes ACP"], ["dsh", "DeepSeek Harness / xLink DSH"], ["codex", "Codex App Server"], ["claude", "Claude Code"], ["cursor", "Cursor · 打开工具讨论"], ["opencode", "OpenCode · 打开工具讨论"]];

export function ConnectionProfileFields({ name, onName, tool, onTool, disabled }: { name: string; onName: (value: string) => void; tool: ToolId; onTool: (value: ToolId) => void; disabled: boolean }) {
  return <section className="qd-connection-profile">
    <label>连接名称<input value={name} onChange={e => onName(e.target.value)} placeholder="例如：工作电脑的 xLink" maxLength={48} disabled={disabled} autoComplete="off" required /></label>
    <label>兼容哪一种工具<select aria-label="兼容哪一种工具" value={tool} onChange={e => onTool(e.target.value as ToolId)} disabled={disabled}>{PROTOCOLS.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
    <p className="qd-connection-note">选择这个程序所兼容的工具，再填写程序位置。只有网页地址的企业版本，请先使用 DSH 的“企业 Web 版”核对接入方式。</p>
  </section>;
}

export function DshDesktopHelp({ os }: { os: GuideOS }) {
  return <details className="qd-desktop-connect-help">
    <summary>使用 xLink / DSH 桌面版？</summary>
    <ol>
      <li><strong>打开 DSH 的命令安装菜单</strong><span>在桌面版中找到 Manage dsh Command，选择 Install / Repair。</span></li>
      <li><strong>新开{os === "windows" ? " PowerShell" : "终端"}，找到程序位置</strong><CopyCommand command={os === "windows" ? "where.exe dsh" : "command -v dsh"} /></li>
      <li><strong>把路径填到下方，再重启 QuanDeck</strong><span>Windows 通常以 dsh.cmd 结尾。无需另装 Node，也不要选择 PowerShell 程序。</span></li>
    </ol>
  </details>;
}
