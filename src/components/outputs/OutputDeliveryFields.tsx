import type { DeliverySlot } from "../../data/goalDelivery";
import type { OutputAttachment } from "../../data/types";
import { Icon } from "../ui/Icon";

export interface OutputDeliveryDraft {
  body: string;
  attachmentKey: string;
}
export interface PendingOutputFile {
  id: string;
  file: File;
}
export function OutputDeliveryFields({
  slots,
  drafts,
  attachments,
  files,
  disabled,
  onChange,
  onUpload,
}: {
  slots: DeliverySlot[];
  drafts: Record<string, OutputDeliveryDraft>;
  attachments: OutputAttachment[];
  files: PendingOutputFile[];
  disabled: boolean;
  onChange: (slotId: string, patch: Partial<OutputDeliveryDraft>) => void;
  onUpload: (files: File[], slotId: string) => void;
}) {
  const provided = (slot: DeliverySlot) =>
    slot.contract!.kind === "text"
      ? !!drafts[slot.id]?.body.trim()
      : !!drafts[slot.id]?.attachmentKey;
  const required = slots.filter((slot) => slot.contract!.required);
  return (
    <section className="qd-output-deliveries" aria-label="逐件交付清单">
      <header>
        <h3>逐件交付</h3>
        <span role="status">
          {required.filter(provided).length} / {required.length} 项必需交付已填写
        </span>
      </header>
      {slots.map((slot, index) => {
        const contract = slot.contract!,
          draft = drafts[slot.id] ?? { body: "", attachmentKey: "" };
        const accepts = (name: string) =>
          contract.format === "any" || name.split(".").at(-1)?.toLowerCase() === contract.format;
        const options = [
          ...attachments.map((file) => ({ key: file.id, name: file.name })),
          ...files.map(({ id, file }) => ({ key: id, name: file.name })),
        ].filter((file) => accepts(file.name));
        return (
          <fieldset key={slot.id} className="qd-output-delivery-item" disabled={disabled}>
            <legend>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {slot.title}
              <small>
                {contract.required ? "必需" : "可选"} ·{" "}
                {contract.kind === "file"
                  ? contract.format.toUpperCase() + " 文件"
                  : contract.format.toUpperCase()}
              </small>
            </legend>
            {slot.description && <p>{slot.description}</p>}
            {contract.kind === "text" ? (
              <label>
                交付正文
                <textarea
                  aria-label={`${slot.title}交付正文`}
                  rows={4}
                  value={draft.body}
                  onChange={(event) => onChange(slot.id, { body: event.target.value })}
                  placeholder={`填写${slot.title}的完整内容`}
                />
              </label>
            ) : (
              <div className="qd-output-delivery-file">
                <label>
                  交付文件
                  <select
                    aria-label={`${slot.title}交付文件`}
                    value={draft.attachmentKey}
                    onChange={(event) =>
                      onChange(slot.id, { attachmentKey: event.target.value })
                    }
                  >
                    <option value="">选择已添加的文件</option>
                    {options.map((file) => (
                      <option key={file.key} value={file.key}>
                        {file.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="qd-btn ghost small">
                  <Icon name="plus" size={13} />
                  上传并选择
                  <input
                    aria-label={`上传${slot.title}`}
                    type="file"
                    className="qd-sr-only"
                    accept={contract.format === "any" ? undefined : `.${contract.format}`}
                    onChange={(event) => {
                      onUpload(Array.from(event.target.files ?? []), slot.id);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
            )}
          </fieldset>
        );
      })}
    </section>
  );
}
