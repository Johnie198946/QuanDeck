import { TaskIcon } from "../ui/TaskIcon";
import "../ui/task-label.css";
import type { ProjectActivityEntry } from "../../data/projectActivity";
import { latestAttempt } from "../../data/orchestration";
import { sessionView } from "../../data/derive";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { AgentLogo } from "../ui/AgentLogo";
import { Icon } from "../ui/Icon";
import { StepTrack } from "../work/WorkStatus";
import { ExecutionRow } from "./ExecutionRow";
import { WorkWaitCard } from "./WorkWaitCard";

export function ProjectActivityRow({ entry }: { entry: ProjectActivityEntry }) {
  const { snap, agentOf, selectWork, openAttemptSource, openSourceSession } = useWorkdeck();
  const o = entry.taskId ? snap.orchestrations?.[entry.taskId] : undefined;
  const item = entry.itemId ? o?.items[entry.itemId] : undefined;
  if (o && item && ["waiting_reply", "waiting_permission", "failed"].includes(entry.state)) return <WorkWaitCard o={o} item={item} />;
  const session = entry.sessionId ? snap.sessions[entry.sessionId] : undefined;
  if (session && !item) return <ExecutionRow item={{ key: entry.id, title: entry.title, taskId: entry.taskId ?? null, session, view: sessionView(session) }} />;
  const agent = agentOf(entry.agentId ?? "");
  const attempt = o && item ? latestAttempt(o, item) : null;
  return <article className={`qd-exec view-${entry.state}`}>
    <button type="button" className="qd-exec-main" onClick={() => {
      if (entry.taskId) selectWork(entry.taskId, entry.itemId ?? null);
      else if (entry.sessionId) openSourceSession(entry.sessionId);
    }}>
      <span className="qd-exec-title"><span className="qd-task-label"><TaskIcon snapshot={snap} taskId={entry.taskId ?? undefined} workItemId={entry.itemId ?? undefined} sessionId={entry.parentSessionId ?? entry.sessionId} subAgentId={entry.subAgentId} size={18} /><span>{entry.title}</span></span></span>
      <span className="qd-exec-meta"><AgentLogo agent={agent} size={15} />{agent.name}
        {attempt?.step?.total ? ` · ${attempt.step.completed ?? 0}/${attempt.step.total} 步` : ""}
        {entry.state === "queued" ? " · 排队" : ""}
      </span>
      {entry.detail && <span className="qd-exec-stage">{entry.detail}</span>}
      {attempt?.step?.total && item ? <StepTrack step={attempt.step} color={agent.color} label={item.title} status={item.status} /> : null}
    </button>
    {entry.sessionId && <button className="qd-icon-btn" type="button" aria-label={`打开 ${entry.title} 的 Agent 会话`} onClick={() => {
      if (entry.taskId && entry.attemptId) openAttemptSource(entry.taskId, entry.attemptId);
      else openSourceSession(entry.sessionId!);
    }}><Icon name="external" size={14} /></button>}
  </article>;
}
