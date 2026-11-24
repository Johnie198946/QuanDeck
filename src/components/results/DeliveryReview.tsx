import { currentDeliverySlots, receiptForSlot } from "../../data/deliveryContract";
import { AcceptedReflection, NewLesson } from "../projects/AcceptedReflection";
import { taskInputClipboardFiles } from '../../data/taskInput';
import { MAX_ATTACHMENT_BYTES, MAX_TASK_ATTACHMENTS } from '../../data/taskAttachments';
import { downloadOutputFile, saveOutputFile, removeOutputFile } from '../../data/outputFiles';
import type { OutputAttachment } from '../../data/types';
import { useRef, useState } from "react";
import { deliveryReview, deliveryReviewCommand } from "../../data/deliveryReview";
import { useWorkdeck } from "../../state/WorkdeckContext";
import {
  reviewChecklist,
  reviewCheckSelected,
  updateReviewChecks,
} from "../outputs/reviewChecklist";

export function DeliveryReview({ artifactId, actionLabel, newLessonOnly }: { artifactId?: string; actionLabel?: string; newLessonOnly?: boolean }) {
  const { snap } = useWorkdeck();
  const view = deliveryReview(snap, artifactId);
  const [fileError,setFileError] = useState('');
  if (!view) return null;
  const pastReviews = snap.collaboration!.reviews.filter(review => review.attachments?.length && snap.collaboration!.submissions.some(s => s.id === review.submissionId && s.artifactId === artifactId));
  const evidence = pastReviews.length > 0 && <div>{pastReviews.map(review => <details key={review.id}><summary>验收截图 · {review.attachments!.length} 张</summary>{review.attachments!.map(file => <button key={file.id} className="qd-link" type="button" onClick={() => void downloadOutputFile(snap.project.id,file).catch(error => setFileError(error.message))}>{file.name} · 下载</button>)}</details>)}{fileError && <p role="alert">{fileError}</p>}</div>;
  if (view.accepted) return <>{evidence}{ view.fresh && view.current && !view.task.archived && !view.task.requiresRevalidation ? (newLessonOnly ? <NewLesson key={view.artifact.id} artifactId={view.artifact.id}/> : <AcceptedReflection key={view.artifact.id} artifactId={view.artifact.id}/>) : null}</>;
  return (
    <>{evidence}<ReviewForm
      key={`${snap.project.id}:${artifactId}:${view.submission?.id}:${view.task.specRevision}:${currentDeliverySlots(
        snap,
        view.task.key,
      )
        .map((slot) => `${slot.id}:${slot.contract?.revision}`)
        .join(",")}`}
      artifactId={artifactId!} actionLabel={actionLabel}
    /></>
  );
}
function ReviewForm({ artifactId, actionLabel }: { artifactId: string; actionLabel?: string }) {
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
  const [screenshots,setScreenshots] = useState<File[]>([]);
  const saved = useRef(new Map<File, OutputAttachment>());
  if (!view) return null;
  const perform = async (verdict: "accepted" | "needs_changes") => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      for (const file of screenshots) {
        if (saved.current.has(file)) continue;
        const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        const attachment = await saveOutputFile(snap.project.id, file);
        saved.current.set(file,{ ...attachment,sha256: Array.from(new Uint8Array(hash),byte => byte.toString(16).padStart(2,'0')).join('') });
      }
      const command = deliveryReviewCommand(snap, artifactId, verdict, checks, note, screenshots.map(file => saved.current.get(file)!));
      if (verdict === "accepted" && items.length)
        (command.payload ??= {}).deliveryChecks = Object.fromEntries(
          items.map((slot) => [slot.id, deliveryChecks[slot.id] ?? []]),
        );
      const result = await api.collaborate(command);
      if (result.ok) { saved.current.clear(); setScreenshots([]); }
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
      <summary>{actionLabel ?? '核对这份成果'}</summary>
      <div className="qd-delivery-review-form">
        <p>
          核对「{view.task.title}」的当前候选 · 要求 v{view.task.specRevision}
          。这次只验收这一项。
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
              onPaste={event => {
                const files = taskInputClipboardFiles(event.clipboardData);
                if (!files.length) return;
                event.preventDefault();
                if (pending.current) return;
                if (screenshots.length + files.length > MAX_TASK_ATTACHMENTS || files.some(file => !['image/png','image/jpeg','image/gif','image/webp'].includes(file.type) || file.size > MAX_ATTACHMENT_BYTES)) {
                  setMessage('可粘贴 PNG、JPEG、GIF 或 WebP 截图，每张最多 25 MB，最多 20 张。'); return;
                }
                const pasted = event.clipboardData.getData('text/plain');
                const { selectionStart, selectionEnd } = event.currentTarget;
                if (pasted) setNote(value => value.slice(0,selectionStart) + pasted + value.slice(selectionEnd));
                setScreenshots(current => [...current,...files]); setMessage('');
              }}
              placeholder="可粘贴截图。认可时说明选填，要求修改时请写意见或附图。"
              rows={3}
            />
          </label>
          {!!screenshots.length && <ul aria-label="待提交验收截图">{screenshots.map((file,i) => <li key={i}>{file.name} <button type="button" className="qd-link" onClick={() => {
            const stored = saved.current.get(file); if (stored) { void removeOutputFile(snap.project.id,stored.id).catch(() => {}); saved.current.delete(file); }
            setScreenshots(current => current.filter((_,n) => n !== i));
          }}>移除</button></li>)}</ul>}
          <div className="qd-delivery-review-actions">
            <button
              type="button"
              className="qd-btn primary"
              disabled={
                !view.canAccept || !checks.every(Boolean) || !itemChecksComplete
              }
              onClick={() => void perform("accepted")}
            >
              确认认可
            </button>
            <button
              type="button"
              className="qd-btn"
              disabled={!note.trim() && !screenshots.length}
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
