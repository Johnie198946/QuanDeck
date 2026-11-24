import { DeliveryChangeDialog } from "./DeliveryChangeDialog";
import { DeliveryPublication } from "./DeliveryPublication";
import { receiptForSlot } from "../../data/deliveryContract";
import { DeliveryReview } from "./DeliveryReview";
import { DeliveryVersionCompare } from "./DeliveryVersionCompare";
import { SpecLineagePanel } from "./SpecLineagePanel";
import { deliveryFocusEvent, requestDeliveryFocus, takeDeliveryFocus } from "./deliveryNavigation";
import { useEffect, useRef, useState } from "react";
import {
  DELIVERY_STATE,
  deliveryPresentation,
  deliverySlotDepth,
  deliverySlotEntry,
  deliverySlotKey,
  deliveryRelations,
  deliverySlotPublication,
  type DeliveryScope,
} from "../../data/deliveryPresentation";
import { resultTime } from "../../data/results";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { TaskOutputButton } from "../outputs/OutputDialog";
import { ResultDocument } from "./ResultDocument";
import { useResultResize } from "./useResultResize";
import "./delivery-map.css";

export function DeliveryMap({ scope = {} }: { scope?: DeliveryScope }) {
  const { snap, openWorkspace, openSourceSession, openProjectDirection } = useWorkdeck();
  const view = deliveryPresentation(snap, scope);
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState(false);
  const [historyId, setHistoryId] = useState("");
  useEffect(() => {
    const focus = () => {
      const id = takeDeliveryFocus(snap.project.id, scope);
      const target = view.slots.find((item) => item.id === id);
      if (target) {
        setSelected(deliverySlotKey(target));
        setHistoryId("");
      }
    };
    focus();
    window.addEventListener(deliveryFocusEvent, focus);
    return () => window.removeEventListener(deliveryFocusEvent, focus);
  }, [snap.project.id, scope.taskId, scope.workItemId, view.slots]);
  const reader = useRef<HTMLDivElement>(null);
  const resizeRef = useResultResize();
  const slot = !historyId
    ? (view.slots.find((item) => deliverySlotKey(item) === selected) ?? view.slots[0])
    : undefined;
  const historical =
    view.history.find((item) => item.entry.record.id === historyId) ??
    (!view.slots.length ? view.history[0] : undefined);
  const report = historical?.entry ?? (slot ? deliverySlotEntry(snap, slot) : null);
  const reviewArtifact =
    slot?.artifact ??
    [...(snap.collaboration?.artifacts ?? [])]
      .reverse()
      .find(
        (artifact) =>
          artifact.outputId === historical?.entry.record.outputId &&
          artifact.body === historical?.entry.record.text,
      );
  const taskId = slot?.taskId ?? historical?.taskId;
  const itemId = slot?.workItemId ?? historical?.entry.record.itemId;
  const task = taskId ? snap.tasks[taskId] : undefined;
  const child = taskId && itemId ? snap.orchestrations?.[taskId]?.items[itemId] : undefined;
  const plan = slot && view.plans.find((item) => item.id === slot.planId);
  const relations = slot
    ? deliveryRelations(slot, view.contributions)
    : { sources: [], targets: [] };
  const publication = slot && deliverySlotPublication(snap, slot, scope);
  const retired = view.plans.flatMap((plan) =>
    plan.slots.filter(
      (item) =>
        item.retired &&
        (!scope.taskId || item.taskId === scope.taskId) &&
        (!scope.workItemId || item.workItemId === scope.workItemId),
    ),
  );
  const receipt = slot && receiptForSlot(slot.artifact, slot);
  const candidates = view.slots.filter((item) => item.state === "candidate").length;
  const revisions = view.slots.filter((item) =>
    ["changes_requested", "stale"].includes(item.state),
  ).length;
  const missing = view.slots.filter((item) =>
    ["empty", "running", "blocked"].includes(item.state),
  ).length;
  const select = (key: string, history = false) => {
    setSelected(history ? "" : key);
    setHistoryId(history ? key : "");
    if (matchMedia("(max-width: 760px)").matches)
      requestAnimationFrame(() => {
        reader.current?.scrollIntoView({
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "start",
        });
        reader.current?.focus({ preventScroll: true });
      });
  };
  const openTaskResults = () =>
    task &&
    openWorkspace(task.id, {
      view: "results",
      selected: itemId ?? null,
      itemId: itemId ?? null,
      focus: true,
    });
  return (
    <section
      ref={resizeRef}
      className="qd-delivery-map"
      aria-label={scope.taskId ? "任务交付地图" : "项目交付地图"}
    >
      <header className="qd-map-summary">
        <div>
          <h2>
            {view.total
              ? `${view.accepted} / ${view.total} 件必需成果已验收`
              : view.slots.length
                ? `${view.slots.length} 件可选成果`
                : "先确定要交付什么"}
          </h2>
          {!!view.total && view.optional > 0 && <p>另有 {view.optional} 件可选成果</p>}
        </div>
        {!!view.total && (
          <dl className="qd-map-counts">
            <div>
              <dt>候选</dt>
              <dd>{candidates}</dd>
            </div>
            <div>
              <dt>待补齐</dt>
              <dd>{missing}</dd>
            </div>
            <div>
              <dt>待修改</dt>
              <dd>{revisions}</dd>
            </div>
          </dl>
        )}
      </header>
      <div className="qd-map-toolbar">
        <div className="qd-map-definition-actions">
          {(view.plans.length > 0 || scope.taskId) && (
            <button type="button" className="qd-link" onClick={() => setEditing(true)}>
              <Icon name={view.slots.length ? "sliders" : "plus"} size={14} />
              {view.slots.length ? "调整交付清单" : "定义交付件"}
            </button>
          )}
          {!view.total && !scope.taskId && (
            <button
              type="button"
              className="qd-link"
              onClick={() => openProjectDirection(snap.project.id)}
            >
              确定项目方向
              <Icon name="arrow-right" size={14} />
            </button>
          )}
        </div>
        <DeliveryPublication scope={scope} />
      </div>
      {editing && (
        <DeliveryChangeDialog
          scope={scope}
          plans={view.plans}
          initialPlanId={slot?.planId}
          onClose={() => setEditing(false)}
        />
      )}
      {(view.slots.length > 0 || view.history.length > 0) && (
        <div className="qd-map-layout">
          <nav className="qd-map-index" aria-label="交付件地图">
            {!!view.slots.length && (
              <>
                <h3>
                  交付清单 <span>{view.slots.length}</span>
                </h3>
                <ol>
                  {view.slots.map((item, index) => (
                    <li
                      key={deliverySlotKey(item)}
                      className={`depth-${deliverySlotDepth(item, view.slots)}`}
                    >
                      <button
                        type="button"
                        className={`state-${item.state}`}
                        data-delivery-slot={item.id}
                        data-delivery-plan={item.planId}
                        data-state={item.state}
                        aria-current={
                          slot?.id === item.id && slot.planId === item.planId ? "true" : undefined
                        }
                        onClick={() => select(deliverySlotKey(item))}
                      >
                        <span className="qd-map-number">{String(index + 1).padStart(2, "0")}</span>
                        <span className="qd-map-chapter-title">
                          <strong>{item.title}</strong>
                          {scope.taskId && (
                            <span className="qd-map-owner">
                              {item.workItemId
                                ? `子任务 · ${snap.orchestrations?.[item.taskId]?.items[item.workItemId]?.title ?? "原子任务"}`
                                : "本任务"}
                            </span>
                          )}
                          <small>
                            <i />
                            {DELIVERY_STATE[item.state]}
                            {item.contract?.required === false && " · 可选"}
                          </small>
                        </span>
                        <Icon name={item.artifact ? "chevron-right" : "dot"} size={14} />
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            )}
            {!!view.history.length && (
              <div className="qd-map-history">
                <h3>
                  {view.slots.length ? "未归入清单的记录" : "交付记录"}{" "}
                  <span>{view.history.length}</span>
                </h3>
                <p>
                  {view.slots.length
                    ? "这些记录保留供查阅，不计入清单完成情况。"
                    : "点开阅读正文与附件。"}
                </p>
                <ol>
                  {view.history.map((item) => (
                    <li key={item.entry.record.id}>
                      <button
                        type="button"
                        aria-current={
                          historical?.entry.record.id === item.entry.record.id ? "true" : undefined
                        }
                        onClick={() => select(item.entry.record.id, true)}
                      >
                        <Icon name="folder" size={15} />
                        <span>
                          <strong>{item.entry.record.title}</strong>
                          <small>
                            {item.taskTitle} · {item.entry.status}
                          </small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </nav>
          <div
            ref={reader}
            tabIndex={-1}
            className="qd-map-reader"
            data-delivery-slot={slot?.id}
            data-delivery-plan={slot?.planId}
            data-state={slot?.state}
            aria-label="选中交付件内容"
          >
            <header className="qd-map-reader-context">
              <div>
                <span>{historical ? "已有交付" : (plan?.title ?? "交付件")}</span>
                <strong>{slot?.title ?? historical?.entry.record.title}</strong>
              </div>
              {slot && (
                <span className={`qd-map-state state-${slot.state}`}>
                  <i />
                  {DELIVERY_STATE[slot.state]}
                </span>
              )}
            </header>
            {slot && (
              <div className="qd-map-origin">
                <span>
                  来自 {task?.title ?? "原任务"}
                  {child && <> / {child.title}</>}
                </span>
                {!scope.taskId && task && (
                  <button type="button" onClick={openTaskResults}>
                    任务成果地图
                    <Icon name="arrow-right" size={12} />
                  </button>
                )}
                {slot.sourceSessionId && (
                  <button type="button" onClick={() => openSourceSession(slot.sourceSessionId!)}>
                    来源会话
                    <Icon name="external" size={12} />
                  </button>
                )}
              </div>
            )}
            {slot?.contract && (
              <dl className="qd-map-contract">
                <div>
                  <dt>形式</dt>
                  <dd>
                    {slot.contract.kind === "file" ? "独立文件" : "正文"} ·{" "}
                    {slot.contract.format.toUpperCase()}
                  </dd>
                </div>
                <div>
                  <dt>要求</dt>
                  <dd>{slot.contract.required ? "必需交付" : "可选交付"}</dd>
                </div>
                <div>
                  <dt>验证</dt>
                  <dd>{receipt ? "内容已验证" : "等待有效交付"}</dd>
                </div>
                <div>
                  <dt>清单</dt>
                  <dd>v{plan?.version ?? 1}</dd>
                </div>
                <div>
                  <dt>发布</dt>
                  <dd>
                    {publication
                      ? `v${publication.version}${publication.current ? " 已发布" : " · 待更新"}`
                      : "尚未发布"}
                  </dd>
                </div>
              </dl>
            )}
            {slot?.contract && (
              <details className="qd-map-criteria">
                <summary>验收条件 · {slot.contract.criteria.length}</summary>
                <ol>
                  {slot.contract.criteria.map((criterion, index) => (
                    <li key={index}>{criterion}</li>
                  ))}
                </ol>
              </details>
            )}
            {(relations.sources.length > 0 || relations.targets.length > 0) && (
              <details className="qd-map-contributions">
                <summary>
                  贡献关系 ·{" "}
                  {relations.sources.length
                    ? `${relations.sources.length} 份来源`
                    : `${relations.targets.length} 个上级成果`}
                </summary>
                {relations.sources.length > 0 && (
                  <div>
                    <h3>由这些任务成果组成</h3>
                    {relations.sources.map((source) => (
                      <button
                        type="button"
                        key={deliverySlotKey(source)}
                        onClick={() => {
                          requestDeliveryFocus(
                            snap.project.id,
                            { taskId: source.taskId, workItemId: source.workItemId },
                            source.id,
                          );
                          openWorkspace(source.taskId, {
                            view: "results",
                            selected: source.workItemId ?? null,
                            itemId: source.workItemId ?? null,
                            focus: true,
                          });
                        }}
                      >
                        <span>
                          {source.title}
                          <small>
                            {snap.tasks[source.taskId]?.title} · {DELIVERY_STATE[source.state]}
                          </small>
                        </span>
                        <Icon name="arrow-right" size={14} />
                      </button>
                    ))}
                  </div>
                )}
                {relations.targets.length > 0 && (
                  <div>
                    <h3>贡献到</h3>
                    {relations.targets.map((target) => (
                      <button
                        type="button"
                        key={deliverySlotKey(target)}
                        onClick={() => {
                          if (
                            snap.collaboration?.goalPlans?.[target.planId]?.at(-1)?.scope ===
                            "project"
                          ) {
                            requestDeliveryFocus(snap.project.id, {}, target.id);
                            window.dispatchEvent(new CustomEvent("quandeck:show-results"));
                          } else {
                            requestDeliveryFocus(
                              snap.project.id,
                              { taskId: target.taskId, workItemId: target.workItemId },
                              target.id,
                            );
                            openWorkspace(target.taskId, {
                              view: "results",
                              selected: target.workItemId ?? null,
                              itemId: target.workItemId ?? null,
                              focus: true,
                            });
                          }
                        }}
                      >
                        <span>
                          {target.title}
                          <small>{DELIVERY_STATE[target.state]}</small>
                        </span>
                        <Icon name="arrow-right" size={14} />
                      </button>
                    ))}
                  </div>
                )}
              </details>
            )}
            {slot?.description && <p className="qd-map-expectation">{slot.description}</p>}
            {slot?.missingReason && (
              <p className={`qd-map-reason state-${slot.state}`} role="status">
                <Icon name={slot.artifact ? "alert" : "clock"} size={16} />
                {slot.missingReason}
              </p>
            )}
            {report && <DeliveryReview artifactId={reviewArtifact?.id} />}
            <DeliveryVersionCompare snapshot={snap} taskId={taskId ?? scope.taskId} itemId={itemId ?? scope.workItemId} openSource={openSourceSession} />
            {report && taskId ? (
              <ResultDocument
                key={`${slot ? deliverySlotKey(slot) : "history"}:${report.record.id}`}
                entry={report}
                taskId={taskId}
                statusLabel={slot ? DELIVERY_STATE[slot.state] : undefined}
                allowEdit={!slot?.contract}
              />
            ) : slot ? (
              <section className="qd-map-empty-slot" aria-label={`${slot.title}尚无成果`}>
                <span className="qd-map-empty-mark" aria-hidden="true">
                  <Icon name="folder" size={28} />
                </span>
                <h2>{slot.title}，这里先留白</h2>
                <p>
                  {slot.state === "running"
                    ? "对应任务正在执行，收到真实交付后会自动填入。"
                    : slot.state === "blocked"
                      ? "完成缺少的条件后，对应任务可以继续。"
                      : "还没有与这件交付要求匹配的内容。"}
                </p>
                <div className="qd-map-empty-line" />
                <small>位置已保留 · 收到有效交付后自动归位</small>
                {task && <TaskOutputButton taskId={task.id} itemId={itemId} />}
              </section>
            ) : null}
            {historical && (
              <p className="qd-map-history-note">
                {historical.taskTitle} · {resultTime(historical.entry.record.at)}
                。此记录不会填充其他待交付位置。
              </p>
            )}
          </div>
        </div>
      )}
      <SpecLineagePanel taskKey={slot?.taskKey} artifactId={slot?.artifact?.id} />
      {retired.length > 0 && (
        <details className="qd-map-retired">
          <summary>已取消的交付件 · {retired.length}</summary>
          <ul>
            {retired.map((item) => (
              <li key={deliverySlotKey(item)}>
                <strong>{item.title}</strong>
                <span>{item.retired!.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!scope.taskId && view.tasks.length > 0 && (
        <details className="qd-map-task-directory">
          <summary>查看任务成果地图 · {view.tasks.length}</summary>
          <ul>
            {view.tasks.map((item) => (
              <li key={item.taskId}>
                <button
                  type="button"
                  onClick={() => openWorkspace(item.taskId, { view: "results", focus: true })}
                >
                  {item.title}
                  <Icon name="arrow-right" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
