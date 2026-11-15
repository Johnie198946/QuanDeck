import { useState } from "react";
import { taskView, VIEW_LABEL } from "../../data/derive";
import type { DemoAction, DemoScenario, DispatchOutcome } from "../../data/types";
import type { OrchDemoAction, TravelStage } from "../../data/repository";
import type { WorkspaceState } from "../../state/WorkdeckContext";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { Popover } from "../ui/Popover";
import { AgentConnectionSetup } from "../deck/AgentConnectionSetup";

const SCENARIOS: { key: DemoScenario; label: string }[] = [
  { key: "submitting", label: "提交中" },
  { key: "acknowledged", label: "源端受理" },
  { key: "running", label: "运行" },
  { key: "waiting_reply", label: "待回复" },
  { key: "waiting_permission", label: "待权限" },
  { key: "unknown", label: "受理未知" },
  { key: "rejected", label: "委派失败" },
  { key: "failed", label: "执行失败" },
  { key: "archived", label: "全部归档 → 完成" },
];

const ACTIONS: { key: DemoAction; label: string }[] = [
  { key: "end_round", label: "结束一轮" },
  { key: "steps_full", label: "步骤 100%" },
  { key: "subagent_done", label: "子代理完成" },
];

const ORCH: { key: OrchDemoAction; label: string }[] = [
  { key: "fail_nested", label: "嵌套子任务失败" },
  { key: "retry", label: "重试失败项" },
  { key: "permission", label: "界面分支待权限" },
  { key: "finish_parallel", label: "并行分支完成" },
  { key: "finish_all", label: "子任务全部结束" },
  { key: "restore", label: "恢复编排" },
];

const TRAVEL: { key: TravelStage | "idea"; label: string }[] = [
  { key: "idea", label: "1 新想法" },
  { key: "discuss", label: "2 讨论结论" },
  { key: "drafts", label: "3 任务草稿" },
  { key: "tree", label: "4 任务树" },
  { key: "local", label: "5 子任务结论" },
  { key: "revision", label: "6 修订影响" },
  { key: "note", label: "成果笔记" },
];

const STAGE_VIEW: Record<TravelStage, Partial<WorkspaceState>> = {
  discuss: { view: "plan" },
  drafts: { view: "plan", mode: "drafts" },
  tree: { view: "tasks", selected: "w-transport" },
  local: { view: "plan", itemId: "w-daily", mode: "drafts" },
  revision: { view: "plan", mode: "revision" },
  note: { view: "tasks", note: true },
};

const OUTCOMES: { key: DispatchOutcome; label: string }[] = [
  { key: "accept", label: "受理" },
  { key: "reject", label: "拒绝" },
  { key: "unknown", label: "受理未知" },
];

/** 顶栏“演示模式”菜单：仅演示数据源可用；所有操作只改变本机演示数据，不连接任何 Agent。 */
export function DemoModeMenu() {
  const { snap, api, toast, linkWithFx, selectWork, openWorkspace, closeWorkspace } = useWorkdeck();
  const [open, setOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const taskIds = snap.journal.blocks
    .filter((b) => b.kind === "task")
    .map((b) => (b as { taskId: string }).taskId);
  const [taskId, setTaskId] = useState(taskIds[0] ?? "");
  const demo = api.demo;
  // 回执设置不改变快照引用，本地跟踪选中项以便立即反映点击
  const [outcome, setOutcome] = useState<DispatchOutcome>(() => demo?.getNextOutcome() ?? "accept");

  if (api.mode !== "sample") return <><button className="qd-sample-badge" onClick={() => setConnecting(true)}>连接设置</button>{connecting && <AgentConnectionSetup onClose={() => setConnecting(false)} />}</>;
  const current = snap.tasks[taskId] ?? snap.tasks[taskIds[0]];

  return (
    <div className="qd-demo-mode">
      <button
        type="button"
        className={`qd-sample-badge ${open ? "is-open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="演示模式：未连接 Agent，所有状态与数字均为演示数据"
      >
        <Icon name="flask" size={15} />
        <span className="qd-sample-full">示例数据</span>
        <span className="qd-sample-mid">示例数据</span>
        <span className="qd-sample-short">演示</span>
        <Icon name="chevron-down" size={14} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label="演示模式与状态演示"
        className="qd-demo-panel"
      >
        <header>
          <strong>演示模式</strong>
          <span className="qd-tag">未连接 Agent</span>
        </header>
        <p className="qd-demo-note">当前任务与进度是示例数据。连接工具后，还需接入项目数据。</p>
        <button type="button" className="qd-btn ghost small" onClick={() => { setOpen(false); setConnecting(true); }}><Icon name="link" size={14} />连接 Agent</button>

        {demo && (
          <>
            <label className="qd-demo-field">
              <span>任务</span>
              <select value={current?.id} onChange={(e) => setTaskId(e.target.value)}>
                {taskIds.map((id) => (
                  <option key={id} value={id}>
                    {snap.tasks[id].title}（{VIEW_LABEL[taskView(snap, snap.tasks[id])]}）
                  </option>
                ))}
              </select>
            </label>
            <div className="qd-demo-field">
              <span>设为状态</span>
              <div className="qd-demo-grid">
                {SCENARIOS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className="qd-chip"
                    onClick={() => {
                      if (!current) return;
                      demo.setScenario(current.id, s.key);
                      toast(`演示：${current.title} → ${s.label}`);
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="qd-demo-field">
              <span>轮次与子代理</span>
              <div className="qd-demo-grid">
                {ACTIONS.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    className="qd-chip"
                    onClick={() => {
                      if (!current) return;
                      const r = demo.runAction(current.id, a.key);
                      toast(r.message ?? "", r.ok ? "info" : "error");
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="qd-demo-field">
              <span>下次委派回执</span>
              <div className="qd-seg" role="radiogroup" aria-label="下一次委派结果">
                {OUTCOMES.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    role="radio"
                    aria-checked={outcome === o.key}
                    className={outcome === o.key ? "is-on" : ""}
                    onClick={() => {
                      demo.setNextOutcome(o.key);
                      setOutcome(o.key);
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="qd-demo-field">
              <span>旅行演示（只替换演示事项）</span>
              <div className="qd-demo-grid">
                {TRAVEL.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className="qd-chip"
                    onClick={() => {
                      setOpen(false);
                      if (t.key === "idea") {
                        closeWorkspace();
                        window.dispatchEvent(
                          new CustomEvent("quandeck:prefill", { detail: "想安排一次轻松旅行，最后做成图文计划" }),
                        );
                        return;
                      }
                      const r = demo.travelStage(t.key);
                      if (r) openWorkspace(r.taskId, { ...STAGE_VIEW[t.key], scope: "root" });
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {snap.orchestrations?.["task-a"] && (
              <div className="qd-demo-field">
                <span>全文搜索编排</span>
                <div className="qd-demo-grid">
                  {ORCH.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      className="qd-chip"
                      onClick={() => {
                        const r = demo.orchestrate(a.key);
                        toast(r.message ?? "", r.ok ? "info" : "error");
                        if (r.ok && a.key === "fail_nested") selectWork("task-a", "w-edge");
                        if (r.ok && a.key === "permission") selectWork("task-a", "w-ui");
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="qd-demo-field">
              <span>合并动效</span>
              <button
                type="button"
                className="qd-btn ghost small qd-demo-merge"
                onClick={async () => {
                  setOpen(false);
                  const { sessionId, taskId: target } = demo.prepareMergeDemo();
                  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
                  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                  document
                    .querySelector(`[data-session-entry="${sessionId}"]`)
                    ?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
                  // 先让源行停留片刻，便于看清“从哪里关联到哪里”
                  await new Promise((r) => setTimeout(r, 900));
                  await linkWithFx(sessionId, target);
                }}
              >
                <Icon name="merge" size={15} />
                演示合并动效
              </button>
            </div>

            <div className="qd-demo-actions">
              <button
                type="button"
                className="qd-btn ghost small"
                onClick={() => {
                  demo.simulateExternalSession();
                  toast("已模拟外部新会话");
                }}
              >
                <Icon name="message" size={15} />
                模拟外部新会话
              </button>
              <button
                type="button"
                className="qd-btn ghost small"
                onClick={() => {
                  demo.reset();
                  setOutcome(demo.getNextOutcome());
                  setTaskId("task-a");
                  toast("已重置演示");
                }}
              >
                <Icon name="undo" size={15} />
                重置演示
              </button>
            </div>
          </>
        )}
      </Popover>
      {connecting && <AgentConnectionSetup onClose={() => setConnecting(false)} />}
    </div>
  );
}
