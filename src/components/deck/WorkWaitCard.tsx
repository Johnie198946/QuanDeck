import { discussionQuestion } from '../../data/discussionSnippets';
import { TaskIcon } from "../ui/TaskIcon";
import "../ui/task-label.css";
import type { CSSProperties } from "react";
import { latestAttempt, WORK_LABEL } from "../../data/orchestration";
import type { Orchestration, WorkItem } from "../../data/types";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { AgentLogo } from "../ui/AgentLogo";
import { Icon } from "../ui/Icon";

/** 全局执行栏中的子任务待处理卡：问题优先，写明所属主任务；回源会话指向该次执行的准确会话 */
export function WorkWaitCard({ o, item }: { o: Orchestration; item: WorkItem }) {
  const { snap, agentOf, selectWork, openAttemptSource } = useWorkdeck();
  const agent = agentOf(o.mainAgentId ?? item.suggestedAgentId ?? "claude");
  const attempt = latestAttempt(o, item);
  const failed = item.status === "failed";
  return (
    <article
      className={`qd-wait-card view-${failed ? "failed" : item.status} is-work`}
      style={{ "--agent": agent.color } as CSSProperties}
    >
      <button
        type="button"
        className="qd-wait-card-title"
        onClick={() => selectWork(o.taskId, item.id)}
        aria-label={`在执行栏查看子任务：${item.title}`}
      >
        <span className="qd-task-label"><TaskIcon snapshot={snap} taskId={o.taskId} workItemId={item.id} size={18} /><span>{item.title}</span></span>
      </button>
      <p className="qd-wait-card-kind">
        <Icon name={failed ? "x-circle" : item.status === "waiting_permission" ? "lock" : "reply"} size={14} />
        <strong>{WORK_LABEL[item.status]}</strong>
        <span className="qd-wait-card-of">· {o.label}</span>
      </p>
      <p className="qd-wait-card-question">{discussionQuestion(item.waiting?.question ?? item.statusReason ?? "")}</p>
      <div className="qd-wait-card-actions">
        {!failed && attempt && (
          <button type="button" className="qd-link" onClick={() => openAttemptSource(o.taskId, attempt.id)}>
            {item.status === "waiting_permission" ? "去授权" : "去回复"}
            <Icon name="external" size={14} />
          </button>
        )}
        {failed && (
          <button type="button" className="qd-btn ghost small" onClick={() => selectWork(o.taskId, item.id)}>
            查看
          </button>
        )}
        <span className="qd-wait-card-agent">
          <AgentLogo agent={agent} size={16} />
          {agent.name}
        </span>
      </div>
    </article>
  );
}
