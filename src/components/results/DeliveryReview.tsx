import { currentDeliverySlots, receiptForSlot } from "../../data/deliveryContract";
import { useRef, useState } from "react";
import { deliveryReview, deliveryReviewCommand } from "../../data/deliveryReview";
import { useWorkdeck } from "../../state/WorkdeckContext";
import {
  reviewChecklist,
  reviewCheckSelected,
  updateReviewChecks,
} from "../outputs/reviewChecklist";

export function DeliveryReview({ artifactId }: { artifactId?: string }) {
  const { snap } = useWorkdeck();
  const view = deliveryReview(snap, artifactId);
  if (!view || view.accepted) return null;
  return (
    <ReviewForm
      key={`${snap.project.id}:${artifactId}:${view.submission?.id}:${view.task.specRevision}:${currentDeliverySlots(
        snap,
        view.task.key,
      )
        .map((slot) => `${slot.id}:${slot.contract?.revision}`)
        .join(",")}`}
      artifactId={artifactId!}
    />
  );
}
function ReviewForm({ artifactId }: { artifactId: string }) {
  const { snap, api, toast } = useWorkdeck(),
    view = deliveryReview(snap, artifactId);
  const [checks, setChecks] = useState<boolean[]>(
    () => view?.spec?.criteria.map(() => false) ?? [],
  );
  const artifact = snap.collaboration?.artifacts.find((item) => item.id === artifactId);
  const inventory = view
    ? currentDeliverySlots(snap, view.task.key).filter((slot) => slot.contract)
    : [];
  const items = inventory.filter(
    (slot) => slot.contract!.required || receiptForSlot(artifact, slot),
  );
  const checklist = reviewChecklist(
    view?.spec?.criteria ?? [],
    inventory.map((slot) => ({
      id: slot.id,
      criteria: slot.contract!.criteria,
      canShare: slot.contract!.required || !!receiptForSlot(artifact, slot),
    })),
  );
  const [deliveryChecks, setDeliveryChecks] = useState<Record<string, boolean[]>>({});
  const itemChecksComplete = items.every(
    (slot) =>
      receiptForSlot(artifact, slot) &&
      slot.contract!.criteria.every((_, index) => deliveryChecks[slot.id]?.[index]),
  );
  const [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const pending = useRef(false);
  if (!view) return null;
  const perform = async (verdict: "accepted" | "needs_changes") => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const command = deliveryReviewCommand(snap, artifactId, verdict, checks, note);
      if (verdict === "accepted" && items.length)
        (command.payload ??= {}).deliveryChecks = Object.fromEntries(
          items.map((slot) => [slot.id, deliveryChecks[slot.id] ?? []]),
        );
      const result = await api.collaborate(command);
      const detail =
        result.message ||
        (result.ok
          ? verdict === "accepted"
            ? "成果已认可，台帐与成果地图已更新。"
            : "已要求修改，原交付和核对记录已保留。"
          : "验收未保存，请重新核对");
      setMessage(detail);
      toast(detail, result.ok ? "info" : "error");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <details className="qd-delivery-review">
      <summary>核对这份成果</summary>
      <div className="qd-delivery-review-form">
        <p>
          核对「{view.task.title}」的当前完整候选 · 要求 v{view.task.specRevision}
          。每件交付按自己的验收条件核对，缺失的交付不会自动通过。
        </p>
        {view.reason && <p role="status">{view.reason}</p>}
        <fieldset disabled={busy || !view.reviewable}>
          <legend>逐项核对验收条件</legend>
          {checklist.taskRows.map((row) => (
            <label key={`task:${row.taskIndexes.join(":")}`}>
              <input
                type="checkbox"
                checked={reviewCheckSelected(row, checks)}
                onChange={(event) =>
                  setChecks((values) =>
                    updateReviewChecks(values, row.taskIndexes, event.target.checked),
                  )
                }
              />
              <span>{row.text}</span>
            </label>
          ))}
          {items.map((slot) => (
            <section
              key={`${slot.id}:${slot.contract!.revision}`}
              className="qd-delivery-item-review"
            >
              <h4>
                {slot.title}
                <small>{slot.contract!.format.toUpperCase()}</small>
              </h4>
              {checklist.hasSharedChecks && (
                <p>
                  当前唯一交付件：{receiptForSlot(artifact, slot)?.fileName || slot.title}
                  。相同的任务条件与交付条件在此核对一次。
                </p>
              )}
              {!receiptForSlot(artifact, slot) && (
                <p role="status">尚未收到这件交付的有效内容，暂时不能验收。</p>
              )}
              {checklist.itemRows[slot.id].map((row, index) => (
                <label key={index}>
                  <input
                    type="checkbox"
                    disabled={!receiptForSlot(artifact, slot)}
                    checked={reviewCheckSelected(row, checks, deliveryChecks[slot.id] ?? [])}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setChecks((values) => updateReviewChecks(values, row.taskIndexes, checked));
                      setDeliveryChecks((values) => ({
                        ...values,
                        [slot.id]: updateReviewChecks(
                          slot.contract!.criteria.map((_, i) => values[slot.id]?.[i] ?? false),
                          row.itemIndexes,
                          checked,
                        ),
                      }));
                    }}
                  />
                  <span>{row.text}</span>
                </label>
              ))}
            </section>
          ))}
          <label className="qd-delivery-review-note">
            <span>验收说明</span>
            <textarea
              maxLength={5000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="记录核对依据，或具体需要修改的地方"
              rows={3}
            />
          </label>
          <div className="qd-delivery-review-actions">
            <button
              type="button"
              className="qd-btn primary"
              disabled={
                !view.fresh || !checks.every(Boolean) || !itemChecksComplete || !note.trim()
              }
              onClick={() => void perform("accepted")}
            >
              确认认可
            </button>
            <button
              type="button"
              className="qd-btn"
              disabled={!note.trim()}
              onClick={() => void perform("needs_changes")}
            >
              要求修改
            </button>
            {busy && <span role="status">正在保存核对结果…</span>}
          </div>
        </fieldset>
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
