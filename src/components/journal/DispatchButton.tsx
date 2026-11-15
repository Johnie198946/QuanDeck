import { useState } from "react";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { Popover } from "../ui/Popover";
import { AgentLogo } from "../ui/AgentLogo";
import type { AgentId } from "../../data/types";

/**
 * 行尾纸飞机：点击按默认目标快捷委派；旁边的目标菜单是拖放的键盘／点击等效入口。
 */
export function DispatchButton({
  onDispatch,
  label,
  busy = false,
}: {
  onDispatch: (agentId: AgentId) => void;
  label: string;
  busy?: boolean;
}) {
  const { snap, agentOf } = useWorkdeck();
  const [open, setOpen] = useState(false);
  const def = agentOf(snap.defaultAgent);
  const targets = snap.agents.filter((a) => a.tracked);

  return (
    <div className="qd-dispatch">
      <button
        type="button"
        className="qd-plane"
        disabled={busy}
        onClick={() => onDispatch(def.id)}
        aria-label={`${label}：委派给默认 Agent ${def.name}`}
        title={`委派给 ${def.name}`}
      >
        <Icon name="plane" size={18} />
      </button>
      <button
        type="button"
        className="qd-plane-more"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}：选择委派目标`}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="chevron-down" size={14} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label="选择委派目标"
        className="qd-target-menu"
      >
        <div className="qd-menu-title">委派给</div>
        {targets.map((a) => {
          const offline = a.connection !== "healthy";
          return (
            <button
              key={a.id}
              type="button"
              className="qd-menu-item"
              disabled={offline}
              onClick={() => {
                setOpen(false);
                onDispatch(a.id);
              }}
            >
              <AgentLogo agent={a} size={22} />
              <span className="qd-menu-item-main">
                <strong>{a.name}</strong>
                {offline && <small>{a.custom ? "待配置" : "未连接"}</small>}
              </span>
              {a.id === snap.defaultAgent && <span className="qd-tag">默认</span>}
            </button>
          );
        })}
      </Popover>
    </div>
  );
}
