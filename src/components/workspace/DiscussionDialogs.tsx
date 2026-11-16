import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { buildDiscussionBrief } from "../../data/discussion";
import type { Agent, IdeaPlan } from "../../data/types";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { gateway, getTestedConnections } from "../../integration/gateway";
import { AgentConnectionSetup } from "../deck/AgentConnectionSetup";
import { toolForAgent } from "../../integration/configuredAgents";

import type { RuntimeCommands } from '../../data/runtimeContracts';
import { desktopHost } from '../../integration/desktop';

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      trigger?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="qd-discussion-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="qd-icon-btn" aria-label="关闭" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

export function DiscussionHandoff({
  plan,
  scope,
  agent,
  onClose,
}: {
  plan: IdeaPlan;
  scope: string;
  agent: Agent;
  onClose: () => void;
}) {
  const { snap, api } = useWorkdeck();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connections, setConnections] = useState(getTestedConnections);
  const [connectionId, setConnectionId] = useState("");
  useEffect(() => {
    const refresh = () => setConnections(getTestedConnections());
    window.addEventListener("quandeck:gateway-tested", refresh);
    return () => window.removeEventListener("quandeck:gateway-tested", refresh);
  }, []);
  const matches = connections.filter(connection => connection.tool === toolForAgent(agent) && connection.discussionOpen && connection.connectionId);
  const selected = matches.find(connection => connection.connectionId === connectionId) ?? matches[0];
  const binding = snap.runtimeConnections?.[agent.id];
  const canStart = Boolean(selected || (desktopHost() && binding));
  const [error, setError] = useState("");
  const text = buildDiscussionBrief(snap, plan, scope);
  const ref = useRef<HTMLTextAreaElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setError("");
    } catch {
      setError("未能复制，请选中下方指令手动复制。");
      ref.current?.focus();
      ref.current?.select();
    }
  };
  const launch = async () => {
    if (!canStart || busy) return;
    setBusy(true); setError("");
    try {
      const selection = await api.setDiscussionAgent(plan.id, agent.id);
      if (!selection.ok) throw new Error(selection.message ?? "讨论目标未保存");
      if (desktopHost() && (binding || selected?.capabilities.dispatch)) {
        const runtime = api as typeof api & RuntimeCommands;
        if (selected?.connectionId && selected.capabilities.dispatch) {
          const bound = await runtime.bindRuntimeConnection(agent.id, { connectionId: selected.connectionId, tool: selected.tool, projectPath: selected.projectPath, capabilities: { ...selected.capabilities } });
          if (!bound.ok) throw new Error(bound.message);
        }
        const started = await runtime.startDiscussion(plan.id, agent.id, scope);
        if (!started.ok) throw new Error(started.message || '无法启动分析');
        const next = await api.load(); const runId = started.sessionId && next.sessions[started.sessionId]?.runtime?.runId;
        if (runId) await desktopHost()!.openRun(runId);
        setOpened('分析已交给 Agent，结论会自动回到当前任务。');
        return;
      }
      if (!selected?.connectionId) throw new Error('请先连接 Agent');
      if (selected.tool === "opencode") await copy();
      const result = await gateway.openDiscussion({connectionId:selected.connectionId, prompt:text});
      if (result.needsPaste) await copy();
      setOpened(result.message);
    } catch (error) { setError(error instanceof Error ? error.message : "打开讨论失败"); }
    finally { setBusy(false); }
  };
  return (
    <Dialog title={`交给 ${agent.name} 讨论`} onClose={onClose}>
      <p className="qd-dialog-description">
        把当前目标和约束带到 Agent 中沟通，完成后在这里汇总结论。
      </p>
      {binding && <p className="qd-dialog-description">工作目录：{binding.projectPath}</p>}
      {matches.length > 0 ? <label className="qd-dialog-field">项目文件夹<select value={selected?.connectionId} onChange={event => setConnectionId(event.target.value)}>{matches.map(connection => <option key={connection.connectionId} value={connection.connectionId}>{connection.projectPath}</option>)}</select></label> : <button type="button" className="qd-btn ghost small" onClick={() => setConnecting(true)}>配置 {agent.name}</button>}
      <label className="qd-dialog-field">
        讨论指令
        <textarea ref={ref} readOnly rows={12} value={text} aria-label="讨论指令（复制到 Agent）" />
      </label>
      {error && (
        <p className="qd-dialog-error" role="alert">
          {error}
        </p>
      )}
      {copied && !opened && (
        <p className="qd-dialog-feedback" role="status">
          已复制。指令尚未发送给 Agent。
        </p>
      )}
      {opened && <p className="qd-dialog-feedback" role="status">{opened}</p>}
      {connecting && <AgentConnectionSetup onClose={() => setConnecting(false)} />}
      <footer>
        <button type="button" className="qd-btn ghost" onClick={onClose}>
          关闭
        </button>
        <button type="button" className={`qd-btn ${canStart ? "ghost" : "primary"}`} onClick={copy}>
          {copied ? "再次复制" : "复制讨论指令"}
        </button>
        {canStart && <button type="button" className="qd-btn primary" disabled={busy} onClick={launch}>{busy ? "正在打开…" : "在 Agent 中开始分析"}</button>}
      </footer>
    </Dialog>
  );
}

export function RecordDiscussionConclusion({
  plan,
  scope,
  agent,
  onClose,
}: {
  plan: IdeaPlan;
  scope: string;
  agent: Agent;
  onClose: () => void;
}) {
  const { api, toast } = useWorkdeck();
  const [summary, setSummary] = useState("");
  const [confirmed, setConfirmed] = useState("");
  const [open, setOpen] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lines = (text: string) =>
    text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.recordDiscussionConclusion(plan.id, scope, {
        agentId: agent.id,
        summary: summary.trim(),
        confirmed: lines(confirmed),
        open: lines(open),
        sourceUrl: sourceUrl.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.message ?? "未能保存结论，请重试。");
        return;
      }
      toast("结论已记录，尚未修改方案正文。");
      onClose();
    } catch {
      setError("未能保存结论，内容已保留，请重试。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="记录 Agent 结论" onClose={onClose}>
      <p className="qd-dialog-description">
        来源：{agent.name}。记录本轮结论后，采用到任务方法。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && summary.trim()) void save();
        }}
      >
        <label className="qd-dialog-field">
          结论摘要
          <textarea
            required
            rows={3}
            maxLength={6000}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="讨论后形成了什么决定？"
          />
        </label>
        <label className="qd-dialog-field">
          已确定 · 每行一项
          <textarea
            rows={3}
            maxLength={6000}
            value={confirmed}
            onChange={(e) => setConfirmed(e.target.value)}
            placeholder="例如：旅行 5 天，高铁往返"
          />
        </label>
        <label className="qd-dialog-field">
          待决定 · 每行一项
          <textarea
            rows={2}
            maxLength={6000}
            value={open}
            onChange={(e) => setOpen(e.target.value)}
            placeholder="还需要在 Agent 中继续确认的问题"
          />
        </label>
        <label className="qd-dialog-field">
          源会话链接 · 可选
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…（准确的讨论会话链接）"
          />
        </label>
        <p className="qd-dialog-description">本条会标记为“手动记录”，保留讨论 Agent 和来源。</p>
        {error && (
          <p className="qd-dialog-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" className="qd-btn ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="qd-btn primary" disabled={busy || !summary.trim()}>
            {busy ? "保存中…" : "保存结论"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
