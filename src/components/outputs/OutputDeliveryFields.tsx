import type { DeliverySlot } from "../../data/goalDelivery";
import type { OutputAttachment } from "../../data/types";
import { Icon } from "../ui/Icon";
import { reviewCheckSelected, type ReviewCheckRow, updateReviewChecks } from "./reviewChecklist";

export interface OutputDeliveryDraft {
  body: string;
  attachmentKey: string;
  checks: boolean[];
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
  reviewDisabled,
  checklist,
  taskChecks,
  onTaskChecks,
  onChange,
  onUpload,
}: {
  slots: DeliverySlot[];
  drafts: Record<string, OutputDeliveryDraft>;
  attachments: OutputAttachment[];
  files: PendingOutputFile[];
  disabled: boolean;
  reviewDisabled: boolean;
  checklist: { itemRows: Record<string, ReviewCheckRow[]>; hasSharedChecks: boolean };
  taskChecks: boolean[];
  onTaskChecks: (indexes: number[], checked: boolean) => void;
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
      <p>逐项填写或选取文件；提交后由系统核验。未完成的项目可以留空保存。</p>
      {slots.map((slot, index) => {
        const contract = slot.contract!,
          draft = drafts[slot.id] ?? { body: "", attachmentKey: "", checks: [] };
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
                  onChange={(event) => onChange(slot.id, { body: event.target.value, checks: [] })}
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
                      onChange(slot.id, { attachmentKey: event.target.value, checks: [] })
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
            <div className="qd-output-delivery-checks">
              <p>
                {checklist.hasSharedChecks
                  ? `当前唯一交付件：${options.find((option) => option.key === draft.attachmentKey)?.name || slot.title}。相同的任务条件与交付条件在此核对一次。`
                  : "完成任务前，请逐条核对"}
              </p>
              {checklist.itemRows[slot.id].map((row, i) => (
                <label key={i}>
                  <input
                    type="checkbox"
                    disabled={!provided(slot) || reviewDisabled}
                    checked={reviewCheckSelected(row, taskChecks, draft.checks)}
                    onChange={(event) => {
                      const checks = updateReviewChecks(
                        contract.criteria.map((_, index) => draft.checks[index] ?? false),
                        row.itemIndexes,
                        event.target.checked,
                      );
                      onChange(slot.id, { checks });
                      onTaskChecks(row.taskIndexes, event.target.checked);
                    }}
                  />
                  <span>{row.text}</span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </section>
  );
}
