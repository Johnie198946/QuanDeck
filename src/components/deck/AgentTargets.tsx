import { useState } from "react";
import type { CSSProperties } from "react";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { useDispatch } from "../journal/TaskRow";
import { AgentLogo } from "../ui/AgentLogo";
import { useConfiguredAgents, testForConfig, toolForAgent } from "../../integration/configuredAgents";

/** 拖动任务时临时展开的 Agent 目标槽；只有有效落点上的明确释放才派发。 */
export function AgentTargets() {
  const { snap, drag, setDrag, toast, setRailPanel, api } = useWorkdeck();
  const { agents, configured, tested } = useConfiguredAgents(snap.agents);
  const dispatch = useDispatch();
  const [over, setOver] = useState<string | null>(null);
  if (drag?.type !== "task") return null;
  const task = snap.tasks[drag.taskId];

  return (
    <div className="qd-targets" role="group" aria-label="委派目标">
      <p className="qd-targets-hint">
        把 <strong>{task?.title}</strong> 拖到 Agent 上委派
      </p>
      <div className="qd-targets-grid">
        {!agents.length && <button type="button" className="qd-btn" onClick={() => setRailPanel("agents")}>先配置 Agent</button>}
        {agents.map((a) => {
            const canDispatch = configured.some((config) => config.tool === toolForAgent(a) && testForConfig(config, tested)?.capabilities.dispatch);
            const offline = !canDispatch || api.mode !== "live" || !snap.agents.some((agent) => agent.id === a.id);
            return (
              <div
                key={a.id}
                className={`qd-target ${over === a.id ? "is-over" : ""} ${offline ? "is-offline" : ""}`}
                style={{ "--agent": a.color } as CSSProperties}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = offline ? "none" : "copy";
                  setOver(a.id);
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  setDrag(null);
                  if (offline) {
                    toast(`${a.name} 未连接，未发送`, "error");
                    return;
                  }
                  dispatch(drag.taskId, a.id);
                }}
              >
                <AgentLogo agent={a} size={22} />
                <strong>{a.name}</strong>
                <small>
                  {offline
                    ? "未连接 · 不可委派"
                    : over === a.id
                      ? "松手委派"
                      : a.id === snap.defaultAgent
                        ? "默认目标"
                        : "可委派"}
                </small>
              </div>
            );
          })}
      </div>
    </div>
  );
}
