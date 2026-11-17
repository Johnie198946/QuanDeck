import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionHealth, ConnectionProbe, FallbackPolicy } from "../../integration/contracts";
import { TOOL_LABELS } from "../../integration/contracts";
import { gateway } from "../../integration/gateway";
import { getConfiguredAgents } from "../../integration/configuredAgents";
import { Icon } from "../ui/Icon";

type ConnectionList = Awaited<ReturnType<typeof gateway.listConnections>>["connections"];
const CHECK_LABELS = { installation: "程序", project: "项目目录", protocol: "连接", login: "登录", model: "模型", quota: "可用额度" };
const DEFAULT_POLICY: FallbackPolicy = { mode: "ask", connectionIds: [] };

export function ConnectionHealthPanel({ connectionId, projectPath, modelProbe, showPolicy = true }: { connectionId: string; projectPath: string; modelProbe?: ConnectionProbe; showPolicy?: boolean }) {
  const [health, setHealth] = useState<ConnectionHealth | null>(null);
  const [connections, setConnections] = useState<ConnectionList>([]);
  const [policy, setPolicy] = useState<FallbackPolicy>(DEFAULT_POLICY);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setBusy(true); setError("");
    try {
      const [next, list] = await Promise.all([gateway.checkHealth(connectionId), gateway.listConnections()]);
      if (generation.current !== current) return;
      setHealth(next); setConnections(list.connections);
      setPolicy(list.connections.find(item => item.connectionId === connectionId)?.fallbackPolicy ?? DEFAULT_POLICY);
    } catch { if (generation.current === current) setError("暂时无法检查。请确认工具与 QuanDeck 已打开，再试一次。"); }
    finally { if (generation.current === current) setBusy(false); }
  }, [connectionId]);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
  const save = async (next: FallbackPolicy) => {
    const current = generation.current;
    setSaving(true); setNotice(""); setError("");
    try {
      await gateway.saveFallbackPolicy(connectionId, next);
      if (current === generation.current) { setPolicy(next); setNotice("备用方案已保存"); }
    } catch { if (current === generation.current) setError("备用方案未保存。请重新检查备用工具是否可用、是否连接同一个项目。"); }
    finally { if (current === generation.current) setSaving(false); }
  };
  const configs = getConfiguredAgents();
  const candidates = connections.filter(item => item.connectionId !== connectionId && item.projectPath === projectPath && item.capabilities?.dispatch);
  const label = (id: string) => {
    const config = configs.find(item => item.connectionId === id);
    const connection = connections.find(item => item.connectionId === id);
    return config?.displayName || (connection ? TOOL_LABELS[connection.tool] : "已移除的连接");
  };
  const canEdit = !busy && !saving;
  const checks = health?.checks.map(check => {
    if (check.key !== "model" || !modelProbe) return check;
    return { ...check, status: modelProbe.status === "connected" ? "passed" as const : "failed" as const, message: modelProbe.message };
  });
  const title = busy ? "检查连接中" : !health ? "还没有检测结果" : health.status === "unavailable" ? health.issue?.title ?? "暂时不能开始" : health.canStart ? "本机启动检查通过" : "还有连接信息待确认";
  return <div className="qd-connection-health" aria-busy={busy}>
    <div className="qd-health-heading"><div><span className={`qd-health-signal is-${health?.status ?? "unknown"}`} aria-hidden="true" /><strong>{title}</strong></div><button type="button" className="qd-link" disabled={busy || saving} onClick={() => void refresh()}>{busy ? "检查中…" : "再检测"}</button></div>
    {health && <>
      <p className="qd-health-time">检测于 {new Date(health.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · 每次开始任务前会再检查</p>
      <ul className="qd-health-checks">{checks?.map(check => <li key={check.key} className={`is-${check.status}`} title={check.message}><Icon name={check.status === "passed" ? "check-circle" : check.status === "failed" ? "alert" : "clock"} size={14}/><span>{CHECK_LABELS[check.key]}</span><small>{check.status === "passed" ? "已确认" : check.status === "failed" ? "需处理" : "待确认"}</small></li>)}</ul>
      {health.issue && <p className="qd-health-issue" role="status">{health.issue.message} {health.issue.action}</p>}
      {checks?.some(check => check.key === "quota" && check.status === "unknown") && <p className="qd-connection-note">{modelProbe ? "剩余额度待确认。" : "模型是否响应、额度是否足够，要等实际请求确认。这里不发送付费测试请求。"}</p>}
    </>}
    {showPolicy && <details className="qd-fallback-settings"><summary>备用方案 <span>{policy.mode === "auto_before_start" ? "启动前自动换用" : "先问我"}</span></summary>
      <p className="qd-connection-note">主工具用不了时，按下面的顺序选择备用工具。费用使用备用工具自己的账户。</p>
      <label>切换方式<select aria-label="切换方式" value={policy.mode} disabled={!canEdit} onChange={e => void save({ ...policy, mode: e.target.value as FallbackPolicy["mode"] })}><option value="ask">先问我</option><option value="auto_before_start" disabled={!policy.connectionIds.length}>尚未开始执行时，自动换用</option></select></label>
      <ol className="qd-fallback-order">{policy.connectionIds.map((id, index) => <li key={id}><span className="qd-fallback-number">{index + 1}</span><span>{label(id)}</span><div><button type="button" className="qd-icon-btn" aria-label={`优先使用 ${label(id)}`} disabled={!canEdit || index === 0} onClick={() => { const ids = [...policy.connectionIds]; [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; void save({ ...policy, connectionIds: ids }); }}><Icon name="chevron-down" className="qd-move-up" size={14}/></button><button type="button" className="qd-icon-btn" aria-label={`移除备用 ${label(id)}`} disabled={!canEdit} onClick={() => { const ids = policy.connectionIds.filter(value => value !== id); void save({ ...policy, connectionIds: ids, ...(!ids.length ? { mode: "ask" as const } : {}) }); }}><Icon name="close" size={14}/></button></div></li>)}</ol>
      <label>添加备用工具<select aria-label="添加备用工具" value="" disabled={!canEdit || !candidates.some(item => !policy.connectionIds.includes(item.connectionId))} onChange={e => { if (e.target.value) void save({ ...policy, connectionIds: [...policy.connectionIds, e.target.value] }); }}><option value="">选择同一项目的工具</option>{candidates.filter(item => !policy.connectionIds.includes(item.connectionId)).map(item => <option key={item.connectionId} value={item.connectionId}>{label(item.connectionId)}</option>)}</select></label>
      {!candidates.length && <p className="qd-connection-note">备用仅能使用同一工作目录内已验证的执行连接；应用 Agent 配置不复制自动切换授权。</p>}
      <p className="qd-connection-note">已经开始的任务会先停下来，由你确认交接。切换会带上任务与已有结果，已完成的记录会保留。</p>
      {notice && <p className="qd-config-saved" role="status">{notice}</p>}
    </details>}
    {error && <p className="qd-connection-error" role="alert">{error}</p>}
  </div>;
}
