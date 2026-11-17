import { TaskIcon } from "../ui/TaskIcon";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OutputAttachment, SaveTaskOutputInput, TaskOutput } from "../../data/types";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { fileSize, removeOutputFile, saveOutputFile } from "../../data/outputFiles";
import { Icon } from "../ui/Icon";
import "./outputs.css";
import { currentDeliverySlots, type DeliveryItemInput } from "../../data/deliveryContract";
import { taskKey } from "../../data/collaboration";
import {
  OutputDeliveryFields,
  type OutputDeliveryDraft,
  type PendingOutputFile,
} from "./OutputDeliveryFields";

export function OutputDialog({
  taskId,
  itemId,
  output,
  onClose,
}: {
  taskId: string;
  itemId?: string | null;
  output?: TaskOutput;
  onClose: () => void;
}) {
  const { snap, api, toast } = useWorkdeck();
  const dialog = useRef<HTMLDialogElement>(null);
  const fieldId = useId();
  const alive = useRef(true);
  const project = useRef(snap.project.id);
  project.current = snap.project.id;
  const initialProject = useRef(snap.project.id).current;
  const item = itemId ? snap.orchestrations?.[taskId]?.items[itemId] : null;
  const taskTitle = item?.title ?? snap.tasks[taskId]?.title ?? "";
  const [title, setTitle] = useState(output?.title ?? taskTitle);
  const [body, setBody] = useState(output?.body ?? "");
  const [linksText, setLinksText] = useState(
    (output?.links ?? []).map((link) => `${link.label} | ${link.url}`).join("\n"),
  );
  const [attachments, setAttachments] = useState<OutputAttachment[]>(output?.attachments ?? []);
  const [files, setFiles] = useState<PendingOutputFile[]>([]);
  const key = taskKey(taskId, itemId);
  const currentTask = snap.collaboration?.tasks[key];
  const currentSpec = snap.collaboration?.specs.find(
    (spec) => spec.key === key && spec.revision === currentTask?.specRevision,
  );
  const [taskSpec] = useState(() => currentSpec && structuredClone(currentSpec));
  const [taskChecks, setTaskChecks] = useState<boolean[]>(
    () => taskSpec?.criteria.map(() => false) ?? [],
  );
  const taskSpecChanged = taskSpec?.revision !== currentSpec?.revision;
  const clearTaskChecks = () => setTaskChecks(taskSpec?.criteria.map(() => false) ?? []);
  const currentSlots = currentDeliverySlots(snap, taskKey(taskId, itemId)).filter(
    (slot) => slot.contract,
  );
  const [slots] = useState(() => structuredClone(currentSlots));
  const initialSignature = useRef(
    JSON.stringify(slots.map((slot) => [slot.id, slot.contract!.revision])),
  ).current;
  const contractChanged =
    initialSignature !==
    JSON.stringify(currentSlots.map((slot) => [slot.id, slot.contract!.revision]));
  const [deliveryDrafts, setDeliveryDrafts] = useState<Record<string, OutputDeliveryDraft>>(() => {
    const prior =
      (output as (TaskOutput & { deliveryItems?: DeliveryItemInput[] }) | undefined)
        ?.deliveryItems ??
      [...(snap.collaboration?.artifacts ?? [])]
        .reverse()
        .find((artifact) => !!output?.id && artifact.outputId === output.id)?.deliveryReceipts ??
      [];
    return Object.fromEntries(
      slots.map((slot) => {
        const item = prior.find(
          (item) => item.slotId === slot.id && item.contractRevision === slot.contract!.revision,
        );
        return [
          slot.id,
          { body: item?.body ?? "", attachmentKey: item?.attachmentId ?? "", checks: [] },
        ];
      }),
    );
  });
  const changeDelivery = (slotId: string, patch: Partial<OutputDeliveryDraft>) => {
    if (patch.body !== undefined || patch.attachmentKey !== undefined) clearTaskChecks();
    setDeliveryDrafts((value) => ({ ...value, [slotId]: { ...value[slotId], ...patch } }));
  };
  const addFiles = (incoming: File[], slotId?: string) => {
    if (incoming.some((file) => file.size > 25 * 1024 * 1024)) {
      setError("每个文件最多 25 MB");
      return;
    }
    const slot = slots.find((slot) => slot.id === slotId);
    if (
      slot &&
      incoming.some(
        (file) =>
          slot.contract!.format !== "any" &&
          file.name.split(".").at(-1)?.toLowerCase() !== slot.contract!.format,
      )
    ) {
      setError(`${slot.title}需要 ${slot.contract!.format.toUpperCase()} 文件`);
      return;
    }
    const pending = incoming.map((file) => ({ id: `pending:${crypto.randomUUID()}`, file }));
    clearTaskChecks();
    setFiles((value) => [...value, ...pending]);
    setError("");
    if (slot && pending[0]) changeDelivery(slot.id, { attachmentKey: pending[0].id, checks: [] });
  };
  const removeFile = (fileId: string) => {
    clearTaskChecks();
    setAttachments((value) => value.filter((file) => file.id !== fileId));
    setFiles((value) => value.filter((file) => file.id !== fileId));
    setDeliveryDrafts((value) =>
      Object.fromEntries(
        Object.entries(value).map(([id, draft]) => [
          id,
          draft.attachmentKey === fileId ? { ...draft, attachmentKey: "", checks: [] } : draft,
        ]),
      ),
    );
  };
  const hasDelivery = (slot: (typeof slots)[number]) =>
    slot.contract!.kind === "text"
      ? !!deliveryDrafts[slot.id]?.body.trim()
      : !!deliveryDrafts[slot.id]?.attachmentKey;
  const canComplete =
    !!taskSpec &&
    !taskSpecChanged &&
    taskChecks.every(Boolean) &&
    slots.every(
      (slot) =>
        (!slot.contract!.required || hasDelivery(slot)) &&
        (!hasDelivery(slot) ||
          slot.contract!.criteria.every((_, i) => deliveryDrafts[slot.id]?.checks[i] === true)),
    );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    alive.current = true;
    const trigger = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      alive.current = false;
      element?.close();
      trigger?.focus();
    };
  }, []);
  useEffect(() => {
    if (snap.project.id !== initialProject) onClose();
  }, [snap.project.id]);
  const save = async (status: "draft" | "published", complete: boolean) => {
    if (busy) return;
    const created: OutputAttachment[] = [];
    setError("");
    setBusy(true);
    try {
      if (!title.trim()) throw new Error("请填写成果标题");
      if (status === "published" && contractChanged)
        throw new Error("交付清单已更新，请关闭后重新打开，核对当前要求再提交");
      if (complete && !canComplete)
        throw new Error("请补齐必需交付，并逐条核对任务及交付件的验收条件");
      const links = linksText
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const parts = line.split("|");
          const raw = parts.at(-1)!.trim();
          let url: URL;
          try {
            url = new URL(raw);
          } catch {
            throw new Error(`链接格式不正确：${raw}`);
          }
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
            throw new Error("链接需要使用 http 或 https 地址");
          return {
            label: parts.length > 1 ? parts.slice(0, -1).join("|").trim() : url.hostname,
            url: url.href,
          };
        });
      if (
        !body.trim() &&
        !links.length &&
        !attachments.length &&
        !files.length &&
        !slots.some(hasDelivery)
      )
        throw new Error("写下结果，或添加链接、文件");
      const uploaded = new Map<string, string>();
      for (const { id, file } of files) {
        const saved = await saveOutputFile(initialProject, file);
        created.push(saved);
        uploaded.set(id, saved.id);
      }
      if (!alive.current || project.current !== initialProject)
        throw new Error("项目已切换，请在原项目重新提交");
      const deliveryItems: DeliveryItemInput[] = slots.filter(hasDelivery).map((slot) => ({
        slotId: slot.id,
        contractRevision: slot.contract!.revision,
        ...(slot.contract!.kind === "text"
          ? { body: deliveryDrafts[slot.id].body.trim() }
          : {
              attachmentId:
                uploaded.get(deliveryDrafts[slot.id].attachmentKey) ??
                deliveryDrafts[slot.id].attachmentKey,
            }),
      }));
      const deliveryChecks = Object.fromEntries(
        slots
          .filter(hasDelivery)
          .map((slot) => [
            slot.id,
            slot.contract!.criteria.map((_, i) => deliveryDrafts[slot.id].checks[i] === true),
          ]),
      );
      const summary =
        body.trim() ||
        deliveryItems
          .map((item) => {
            const slot = slots.find((slot) => slot.id === item.slotId)!;
            return `${slot.title}\n${item.body ?? [...attachments, ...created].find((file) => file.id === item.attachmentId)?.name ?? ""}`;
          })
          .join("\n\n");
      const input: SaveTaskOutputInput & {
        deliveryItems?: DeliveryItemInput[];
        deliveryChecks?: Record<string, boolean[]>;
      } = {
        projectId: initialProject,
        id: output?.id,
        taskId,
        workItemId: itemId ?? null,
        title: title.trim(),
        body: summary,
        links,
        attachments: [...attachments, ...created],
        status,
        complete,
        ...(complete ? { taskChecks, taskSpecRevision: taskSpec!.revision } : {}),
        ...(slots.length ? { deliveryItems, deliveryChecks } : {}),
      };
      const result = await api.saveTaskOutput(input);
      if (!result.ok) throw new Error(result.message ?? "成果未保存");
      const removed =
        output?.attachments?.filter(
          (file) =>
            !attachments.some((saved) => saved.id === file.id) &&
            !snap.collaboration?.artifacts.some((artifact) =>
              artifact.attachments?.some((saved) => saved.id === file.id),
            ),
        ) ?? [];
      await Promise.all(
        removed.map((file) => removeOutputFile(initialProject, file.id).catch(() => {})),
      );
      toast(
        status === "draft"
          ? "草稿已保存"
          : complete
            ? "成果已归入成果页，任务已完成"
            : "成果已归入成果页",
      );
      onClose();
    } catch (e) {
      await Promise.all(
        created.map((file) => removeOutputFile(initialProject, file.id).catch(() => {})),
      );
      if (alive.current) setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const remove = async () => {
    if (!output || busy) return;
    setBusy(true);
    try {
      const result = await api.deleteTaskOutput(output.id);
      if (!result.ok) throw new Error(result.message ?? "删除失败");
      await Promise.all(
        (output.attachments ?? [])
          .filter(
            (file) =>
              !snap.collaboration?.artifacts.some((artifact) =>
                artifact.attachments?.some((saved) => saved.id === file.id),
              ),
          )
          .map((file) => removeOutputFile(initialProject, file.id).catch(() => {})),
      );
      toast("成果已移除");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
      setBusy(false);
    }
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="qd-output-dialog"
      aria-labelledby={`${fieldId}-heading`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <div>
          <p className="qd-task-name">
            <TaskIcon snapshot={snap} taskId={taskId} workItemId={itemId ?? undefined} size={18} />
            <span>{taskTitle}</span>
          </p>
          <h2 id={`${fieldId}-heading`}>{output ? "编辑成果" : "记录我的成果"}</h2>
        </div>
        <button
          type="button"
          className="qd-icon-btn"
          aria-label="关闭成果编辑"
          disabled={busy}
          onClick={onClose}
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      <div
        className="qd-output-editor"
        onPaste={(event) => {
          const incoming = Array.from(event.clipboardData.files);
          if (incoming.length) {
            event.preventDefault();
            addFiles(incoming);
          }
        }}
      >
        <div className="qd-output-field">
          <label htmlFor={`${fieldId}-title`}>成果标题</label>
          <input
            id={`${fieldId}-title`}
            autoFocus
            disabled={busy}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              clearTaskChecks();
            }}
            maxLength={180}
            placeholder="为这份成果起个名字"
          />
        </div>
        <div className="qd-output-field">
          <label htmlFor={`${fieldId}-body`}>
            {slots.length ? "交付说明（选填）" : "结果内容"}
          </label>
          <textarea
            id={`${fieldId}-body`}
            rows={slots.length ? 2 : 7}
            disabled={busy}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              clearTaskChecks();
            }}
            placeholder="完成了什么、得到什么结论，可以直接粘贴笔记或 Markdown。"
          />
        </div>
        {slots.length > 0 && (
          <OutputDeliveryFields
            slots={slots}
            drafts={deliveryDrafts}
            attachments={attachments}
            files={files}
            disabled={busy}
            onChange={changeDelivery}
            onUpload={addFiles}
          />
        )}
        <details open={!!linksText}>
          <summary>添加链接</summary>
          <label className="qd-sr-only" htmlFor={`${fieldId}-links`}>
            成果链接
          </label>
          <textarea
            id={`${fieldId}-links`}
            rows={2}
            disabled={busy}
            value={linksText}
            onChange={(e) => {
              setLinksText(e.target.value);
              clearTaskChecks();
            }}
            placeholder="每行一条：名称 | https://…"
          />
        </details>
        <div className="qd-output-file-heading">
          <label className="qd-btn ghost small">
            <Icon name="plus" size={14} />
            添加文件
            <input
              type="file"
              multiple
              className="qd-sr-only"
              disabled={busy}
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </label>
          <small>支持粘贴图片与多格式文件 · 每个文件最多 25 MB</small>
        </div>
        <ul className="qd-output-files">
          {attachments.map((file) => (
            <li key={file.id}>
              <span>
                {file.name}
                <small>{fileSize(file.size)}</small>
              </span>
              <button
                type="button"
                aria-label={`移除 ${file.name}`}
                disabled={busy}
                onClick={() => removeFile(file.id)}
              >
                <Icon name="close" size={13} />
              </button>
            </li>
          ))}
          {files.map(({ id, file }) => (
            <li key={id}>
              <span>
                {file.name}
                <small>{fileSize(file.size)}</small>
              </span>
              <button
                type="button"
                disabled={busy}
                aria-label={`移除 ${file.name}`}
                onClick={() => removeFile(id)}
              >
                <Icon name="close" size={13} />
              </button>
            </li>
          ))}
        </ul>
        <fieldset
          className="qd-output-delivery-item qd-output-delivery-checks"
          disabled={busy || taskSpecChanged || !taskSpec}
        >
          <legend>任务验收条件{taskSpec ? ` · v${taskSpec.revision}` : ""}</legend>
          <p>提交并完成任务前，请逐项确认。修改交付内容后需要重新核对。</p>
          {taskSpec?.criteria.map((criterion, index) => (
            <label key={`${index}:${criterion}`}>
              <input
                type="checkbox"
                checked={taskChecks[index] === true}
                onChange={(event) =>
                  setTaskChecks((values) =>
                    values.map((value, i) => (i === index ? event.target.checked : value)),
                  )
                }
              />
              <span>{criterion}</span>
            </label>
          ))}
          {!taskSpec && <p role="status">任务验收条件尚未准备好，可以先保存或提交成果。</p>}
        </fieldset>
        {taskSpecChanged && (
          <p className="qd-output-error" role="alert">
            任务验收条件已更新，请重新打开表单核对后再完成任务。当前内容仍可保存或提交。
          </p>
        )}
        {contractChanged && (
          <p className="qd-output-error" role="alert">
            交付清单已更新。你可以保留草稿，重新打开后核对当前要求。
          </p>
        )}
        {error && (
          <p className="qd-output-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer>
        {output && (
          <button
            type="button"
            className="qd-output-delete"
            disabled={busy}
            onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))}
          >
            {confirmDelete ? "确认移除成果" : "移除"}
          </button>
        )}
        <div>
          <button
            type="button"
            className="qd-btn ghost small"
            disabled={busy}
            onClick={() => void save("draft", false)}
          >
            存草稿
          </button>
          <button
            type="button"
            className="qd-btn ghost small"
            disabled={busy || contractChanged}
            onClick={() => void save("published", false)}
          >
            提交成果
          </button>
          <button
            type="button"
            className="qd-btn primary small"
            disabled={busy || contractChanged || !canComplete}
            onClick={() => void save("published", true)}
          >
            {busy ? "保存中…" : "提交并完成任务"}
          </button>
        </div>
      </footer>
    </dialog>,
    document.body,
  );
}

export function TaskOutputButton({
  taskId,
  itemId,
  compact = false,
}: {
  taskId: string;
  itemId?: string | null;
  compact?: boolean;
}) {
  const { snap } = useWorkdeck();
  const [open, setOpen] = useState(false);
  const draft = Object.values(snap.outputs ?? {}).find(
    (output) =>
      output.taskId === taskId &&
      (output.workItemId ?? null) === (itemId ?? null) &&
      output.status === "draft",
  );
  return (
    <>
      <button
        type="button"
        className={compact ? "qd-text-btn qd-task-entry" : "qd-btn ghost small"}
        onClick={() => setOpen(true)}
      >
        <Icon name="pencil" size={13} />
        {draft ? "继续成果草稿" : "记录成果"}
      </button>
      {open && (
        <OutputDialog
          key={`${snap.project.id}:${taskId}:${itemId}`}
          taskId={taskId}
          itemId={itemId}
          output={draft}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
