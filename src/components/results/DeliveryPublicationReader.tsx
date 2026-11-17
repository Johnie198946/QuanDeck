import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IntegrationVersion } from "../../data/resultIntegration";
import type { PresentedResult } from "../../data/resultPresentation";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { ResultDocument } from "./ResultDocument";

/** Reads the immutable publication snapshot, even when today's slots have changed or disappeared. */
export function DeliveryPublicationReader({
  versions,
  onClose,
}: {
  versions: IntegrationVersion[];
  onClose: () => void;
}) {
  const { snap } = useWorkdeck();
  const dialog = useRef<HTMLDialogElement>(null),
    heading = useId();
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const version = versions.find((item) => item.id === versionId) ?? versions[0];
  const [selected, setSelected] = useState("");
  const items = version?.deliveryPublication?.items ?? [];
  const item = items.find((item) => item.slotId === selected) ?? items[0];
  const artifact = item?.artifactId
    ? snap.collaboration?.artifacts.find((artifact) => artifact.id === item.artifactId)
    : undefined;
  const pin = version?.sourcePins.find((pin) => pin.artifactId === item?.artifactId);
  const receipt = item?.receipt;
  const attachments = receipt?.attachmentId
    ? artifact?.attachments?.filter((file) => file.id === receipt.attachmentId)
    : [];
  const entry: PresentedResult | undefined =
    item && receipt
      ? {
          status: "已确认",
          sessionId: pin?.sessionId,
          runId: pin?.runtimeRunId,
          record: {
            id: `${version.id}:${item.slotId}`,
            outputId: artifact?.outputId,
            title: item.title,
            text: receipt.body ?? receipt.textBody ?? "",
            at: version.at,
            origin: artifact?.runId ? "agent" : "human",
            attachments,
            sessionId: pin?.sessionId,
          },
        }
      : undefined;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="qd-published-reader"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <span>正式成果 · 固定版本</span>
          <h2 id={heading}>{version?.title ?? "已发布成果"}</h2>
        </div>
        <label>
          <span>版本</span>
          <select
            aria-label="选择已发布版本"
            value={version?.id}
            onChange={(event) => {
              setVersionId(event.target.value);
              setSelected("");
            }}
          >
            {versions.map((value) => (
              <option key={value.id} value={value.id}>
                v{value.version} · {new Date(value.at).toLocaleDateString()}
              </option>
            ))}
          </select>
        </label>
        <button type="button" aria-label="关闭已发布成果" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </header>
      <p className="qd-published-context">
        这是发布时固定的内容。当前交付清单的修改不会改变此版本。
      </p>
      <div className="qd-published-layout">
        <nav aria-label="已发布交付件">
          <ol>
            {items.map((value) => (
              <li key={value.slotId}>
                <button
                  type="button"
                  aria-current={item?.slotId === value.slotId ? "true" : undefined}
                  onClick={() => setSelected(value.slotId)}
                >
                  {value.title}
                  <small>
                    {value.contract.format.toUpperCase()} ·{" "}
                    {value.receipt ? "已发布" : "本版未包含"}
                  </small>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="qd-published-content">
          {entry ? (
            <ResultDocument
              key={`${version.id}:${item.slotId}`}
              entry={entry}
              taskId={pin?.taskId ?? ""}
              statusLabel={`已发布 v${version.version}`}
              allowEdit={false}
            />
          ) : (
            <p>本次发布未包含这项可选交付。</p>
          )}
          {receipt?.kind === "file" && !attachments?.length && (
            <p role="status">
              此版本保留了文件「{receipt.fileName}」的验证记录，但当前无法读取原附件。
            </p>
          )}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
