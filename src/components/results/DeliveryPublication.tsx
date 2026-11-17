import { useCallback, useEffect, useRef, useState } from "react";
import type { DeliveryScope } from "../../data/deliveryPresentation";
import type { DeliveryPublicationPreview } from "../../data/deliveryPublication";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { DeliveryPublicationReader } from "./DeliveryPublicationReader";
import { ConfirmDialog } from "../ui/ConfirmDialog";

/** Publishing is an explicit human command; a filled map is not a published release. */
export function DeliveryPublication({ scope }: { scope: DeliveryScope }) {
  const { snap, api, toast } = useWorkdeck();
  const [reading, setReading] = useState(false);
  const scopeKey = scope.workItemId
    ? `task:${scope.taskId}:work:${scope.workItemId}`
    : scope.taskId
      ? `task:${scope.taskId}`
      : "project";
  const versions = [...(snap.integration?.versions ?? [])]
    .filter((version) => version.deliveryPublication?.scopeKey === scopeKey)
    .sort((a, b) => b.version - a.version);
  const [preview, setPreview] = useState<DeliveryPublicationPreview>();
  const [open, setOpen] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef(0),
    pending = useRef(false),
    key = useRef("");
  const lastFingerprint = useRef("");
  const readPreview = useCallback(async () => {
    const sequence = ++request.current;
    try {
      const value = await api.previewDeliveryPublication(snap.project.id, scope);
      if (sequence !== request.current) return;
      if (lastFingerprint.current !== value.fingerprint) {
        setReviewed(false);
        key.current = `publish-delivery-${crypto.randomUUID()}`;
        lastFingerprint.current = value.fingerprint;
      }
      setPreview(value);
      setError("");
    } catch (cause) {
      if (sequence === request.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [api, snap.project.id, scope.taskId, scope.workItemId]);
  useEffect(() => {
    void readPreview();
    return () => {
      request.current++;
    };
  }, [readPreview, snap]);
  const publish = async () => {
    if (!preview?.canPublish || !reviewed || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api.publishDelivery(snap.project.id, {
        scope,
        expectedFingerprint: preview.fingerprint,
        reviewed: true,
        idempotencyKey: key.current,
      });
      if (result.ok) {
        toast("已正式发布，当前成果版本已固定。");
        setOpen(false);
      } else {
        setReviewed(false);
        await readPreview();
        setError(result.message ?? "发布未完成，请重新核对");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const published = preview?.publishedVersion;
  return (
    <div className="qd-delivery-publication">
      <span className={published?.current ? "is-published" : ""}>
        {published
          ? `已发布 v${published.version}${published.current ? "" : " · 有待发布更新"}`
          : "尚未正式发布"}
      </span>
      <button
        type="button"
        className="qd-link"
        onClick={() => {
          setOpen(true);
          void readPreview();
        }}
      >
        {scope.taskId ? "发布任务成果" : "发布项目成果"}
      </button>
      {versions.length > 0 && (
        <button type="button" className="qd-link" onClick={() => setReading(true)}>
          阅读已发布版本
        </button>
      )}
      {reading && (
        <DeliveryPublicationReader versions={versions} onClose={() => setReading(false)} />
      )}
      {open && (
        <ConfirmDialog
          title={scope.taskId ? "正式发布任务成果" : "正式发布项目成果"}
          text="发布会固定这一版交付清单及其已验收内容。后续变更需要发布新版本。"
          confirmLabel={busy ? "正在发布…" : "确认发布"}
          busy={busy}
          error={error}
          confirmDisabled={!preview?.canPublish || !reviewed}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          onConfirm={() => void publish()}
        >
          {!preview ? (
            <p role="status">正在核对交付清单…</p>
          ) : (
            <div className="qd-delivery-publication-preview">
              <h3>{preview.title}</h3>
              <ul>
                {preview.items.map((item) => (
                  <li key={item.slotId}>
                    <span>{item.title}</span>
                    <small>
                      {item.format?.toUpperCase()} · {item.required ? "必需" : "可选"}
                    </small>
                  </li>
                ))}
              </ul>
              {!!preview.blockers.length && (
                <div role="status">
                  <strong>发布前还需要</strong>
                  <ul>
                    {preview.blockers.map((message, index) => (
                      <li key={index}>{message}</li>
                    ))}
                  </ul>
                </div>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={busy || !preview.canPublish}
                  onChange={(event) => setReviewed(event.target.checked)}
                />
                已阅读并核对本次发布的全部交付件
              </label>
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
