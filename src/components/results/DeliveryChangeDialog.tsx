import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { workBranch } from "../../data/results";
import { taskKey } from "../../data/collaboration";
import type {
  DeliveryChangeInput,
  DeliveryChangeOperation,
  DeliveryChangeResult,
} from "../../data/deliveryChanges";
import type { DeliverySlotDraft, GoalPlanVersion } from "../../data/goalDelivery";
import type { DeliveryScope } from "../../data/deliveryPresentation";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";

type Operation = DeliveryChangeOperation["type"];
const LABELS: Record<Operation, string> = {
  add: "新增",
  update: "修改",
  cancel: "取消",
  replace: "替换",
  split: "拆分",
  merge: "合并",
};
const newSlot = (key: string): DeliverySlotDraft => ({
  id: `delivery-${crypto.randomUUID()}`,
  title: "",
  taskKey: key,
  contract: {
    revision: 1,
    kind: "text",
    format: "markdown",
    required: true,
    criteria: [],
    purpose: "deliverable",
  },
});

/** User edits are drafts. Only a successful, version-checked backend command changes the inventory. */
export function DeliveryChangeDialog({
  scope,
  plans,
  initialPlanId,
  onClose,
}: {
  scope: DeliveryScope;
  plans: GoalPlanVersion[];
  initialPlanId?: string;
  onClose: () => void;
}) {
  const { snap, api, toast } = useWorkdeck();
  const dialog = useRef<HTMLDialogElement>(null),
    heading = useId(),
    pending = useRef(false);
  const [planId, setPlanId] = useState(initialPlanId ?? plans[0]?.id ?? "");
  const plan = plans.find((item) => item.id === planId);
  const scopeKey = scope.taskId ? taskKey(scope.taskId, scope.workItemId) : "";
  const orchestration = scope.taskId ? snap.orchestrations?.[scope.taskId] : undefined;
  const branch = scope.workItemId
    ? new Set(
        orchestration
          ? workBranch(orchestration, scope.workItemId).map((item) => item.id)
          : [scope.workItemId],
      )
    : undefined;
  const belongs = (item: { taskId: string; workItemId?: string }) =>
    (!scope.taskId || item.taskId === scope.taskId) &&
    (!branch || (!!item.workItemId && branch.has(item.workItemId)));
  const bindings = plan
    ? plan.tasks.filter(belongs)
    : scope.taskId
      ? [{ key: scopeKey, taskId: scope.taskId, workItemId: scope.workItemId }]
      : [];
  const contributionBindings = bindings.filter(binding => plan?.scope !== 'project' || !('assembly' in binding && binding.assembly));
  const available = plan?.slots.filter((slot) => !slot.retired && belongs(slot)) ?? [];
  const [operation, setOperation] = useState<Operation>("add");
  const [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<DeliverySlotDraft[]>([
    newSlot(contributionBindings[0]?.key ?? scopeKey),
  ]);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{
    input: DeliveryChangeInput;
    result: DeliveryChangeResult;
  }>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const currentVersion =
    snap.collaboration?.goalPlans?.[plan?.id ?? `delivery:${scopeKey}`]?.at(-1)?.version ?? 0;
  const outdated = !!preview && preview.input.expectedVersion !== currentVersion;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  const invalidate = () => {
    setPreview(undefined);
    setError("");
  };
  const chooseOperation = (value: Operation) => {
    setOperation(value);
    setSelected([]);
    setDrafts([
      newSlot(contributionBindings[0]?.key ?? scopeKey),
      ...(value === "split" ? [newSlot(contributionBindings[0]?.key ?? scopeKey)] : []),
    ]);
    invalidate();
  };
  const chooseSlot = (id: string) => {
    const slot = available.find((item) => item.id === id);
    if (operation === "merge")
      setSelected((values) =>
        values.includes(id) ? values.filter((value) => value !== id) : [...values, id],
      );
    else {
      setSelected([id]);
      if (operation === "update" && slot)
        setDrafts([{ ...slot, contract: slot.contract ?? newSlot(slot.taskKey).contract }]);
    }
    invalidate();
  };
  const patch = (index: number, value: Partial<DeliverySlotDraft>) => {
    setDrafts((values) => values.map((slot, i) => (i === index ? { ...slot, ...value } : slot)));
    invalidate();
  };
  const ready =
    reason.trim() &&
    (operation === "add" || selected.length >= (operation === "merge" ? 2 : 1)) &&
    (operation === "cancel" ||
      drafts.every(
        (slot) =>
          slot.title.trim() && slot.taskKey && slot.contract?.criteria.some((text) => text.trim()),
      ));
  const previewChanges = async () => {
    if (pending.current || !ready) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const clean = drafts.map((slot) => ({
      ...slot,
      title: slot.title.trim(),
      contract: slot.contract && {
        ...slot.contract,
        criteria: slot.contract.criteria.map((text) => text.trim()).filter(Boolean),
      },
    }));
    const operations: DeliveryChangeOperation[] =
      operation === "add"
        ? clean.map((slot) => ({ type: "add", slot }))
        : operation === "update"
          ? [
              {
                type: "update",
                slotId: selected[0],
                patch: {
                  title: clean[0].title,
                  description: clean[0].description,
                  taskKey: clean[0].taskKey,
                  contract: clean[0].contract,
                  contributionIds: clean[0].contributionIds,
                },
              },
            ]
          : operation === "cancel"
            ? selected.map((slotId) => ({ type: "cancel", slotId }))
            : [{ type: operation, slotIds: selected, slots: clean }];
    const input: DeliveryChangeInput = {
      planId: plan?.id ?? `delivery:${scopeKey}`,
      expectedVersion: plan?.version ?? 0,
      idempotencyKey: `delivery-change-${crypto.randomUUID()}`,
      reason: reason.trim(),
      operations,
      ...(!plan && scope.taskId ? { taskId: scope.taskId, workItemId: scope.workItemId } : {}),
    };
    try {
      const result = await api.previewDeliveryChange(snap.project.id, input);
      if (result.ok) setPreview({ input, result });
      else setError(result.message ?? "无法预览，请核对清单");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!preview || outdated || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api.applyDeliveryChange(snap.project.id, preview.input);
      if (result.ok) {
        toast(`交付清单已保存为 v${result.version ?? result.nextVersion}`);
        onClose();
      } else {
        setError(result.message ?? "保存失败，草稿已保留");
        if (result.code === "VERSION_CONFLICT") setPreview(undefined);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="qd-delivery-change-dialog"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <div>
          <span>
            {scope.taskId ? "任务交付清单" : "项目最终交付清单"}
            {plan && ` · v${plan.version}`}
          </span>
          <h2 id={heading}>{plan ? "调整交付件" : "定义交付件"}</h2>
        </div>
        <button type="button" aria-label="关闭交付清单" disabled={busy} onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="qd-delivery-change-body">
        <p className="qd-delivery-change-intro">
          先定义每件要交付的内容，再核对受影响的任务。旧版本和已有成果会保留。
        </p>
        {plans.length > 1 && (
          <label>
            交付清单
            <select
              disabled={busy}
              value={planId}
              onChange={(event) => {
                setPlanId(event.target.value);
                setOperation("add");
                setSelected([]);
                setDrafts([
                  newSlot(
                    plans.find((item) => item.id === event.target.value)?.tasks.find(belongs)
                      ?.key ?? scopeKey,
                  ),
                ]);
                invalidate();
              }}
            >
              {plans.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · v{item.version}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset disabled={busy}>
          <legend>这次要怎样调整</legend>
          <div className="qd-delivery-operation-options">
            {(Object.keys(LABELS) as Operation[]).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name={`${heading}-operation`}
                  value={value}
                  checked={operation === value}
                  disabled={!available.length && value !== "add"}
                  onChange={() => chooseOperation(value)}
                />
                {LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>
        {operation !== "add" && (
          <fieldset disabled={busy}>
            <legend>{operation === "merge" ? "选择至少两件合并" : "选择要调整的交付件"}</legend>
            <div className="qd-delivery-change-selection">
              {available.map((slot) => (
                <label key={slot.id}>
                  <input
                    type={operation === "merge" ? "checkbox" : "radio"}
                    name={`${heading}-source`}
                    checked={selected.includes(slot.id)}
                    onChange={() => chooseSlot(slot.id)}
                  />
                  <span>
                    {slot.title}
                    <small>{slot.contract?.format.toUpperCase() ?? "原有交付"}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {operation !== "cancel" && (
          <fieldset disabled={busy}>
            <legend>{operation === "update" ? "交付要求" : "调整后的交付件"}</legend>
            {drafts.map((slot, index) => (
              <div className="qd-delivery-draft-item" key={slot.id}>
                <div className="qd-delivery-draft-heading">
                  <strong>{String(index + 1).padStart(2, "0")}</strong>
                  {drafts.length > (operation === "split" ? 2 : 1) && (
                    <button
                      type="button"
                      aria-label={`移除第 ${index + 1} 件草稿`}
                      onClick={() => {
                        setDrafts((values) => values.filter((_, i) => i !== index));
                        invalidate();
                      }}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  )}
                </div>
                <label>
                  交付名称
                  <input
                    maxLength={200}
                    value={slot.title}
                    onChange={(event) => patch(index, { title: event.target.value })}
                    placeholder="例如：可打印行程、预算表、完整攻略"
                  />
                </label>
                <div className="qd-delivery-field-pair">
                  <label>
                    内容形式
                    <select
                      value={slot.contract?.kind ?? "text"}
                      onChange={(event) =>
                        patch(index, {
                          contract: {
                            ...slot.contract!,
                            kind: event.target.value as "text" | "file",
                            format: event.target.value === "text" ? "markdown" : "pdf",
                          },
                        })
                      }
                    >
                      <option value="text">正文</option>
                      <option value="file">独立文件</option>
                    </select>
                  </label>
                  <label>
                    格式
                    <select
                      value={slot.contract?.format ?? "markdown"}
                      onChange={(event) =>
                        patch(index, {
                          contract: { ...slot.contract!, format: event.target.value },
                        })
                      }
                    >
                      {(slot.contract?.kind === "file"
                        ? [
                            "pdf",
                            "html",
                            "docx",
                            "xlsx",
                            "csv",
                            "png",
                            "jpg",
                            "svg",
                            "mp4",
                            "zip",
                            "any",
                          ]
                        : ["markdown", "text", "json", "html"]
                      ).map((format) => (
                        <option key={format} value={format}>
                          {format === "any" ? "不限文件格式" : format.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  负责任务
                  <select
                    value={slot.taskKey}
                    onChange={(event) => patch(index, { taskKey: event.target.value, contributionIds: undefined })}
                  >
                    {bindings.filter(binding => contributionBindings.includes(binding) || binding.key === slot.taskKey).map((binding) => (
                      <option key={binding.key} value={binding.key}>
                        {binding.workItemId
                          ? (snap.orchestrations?.[binding.taskId]?.items[binding.workItemId]
                              ?.title ?? "子任务")
                          : (snap.tasks[binding.taskId]?.title ?? "任务")}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  验收条件
                  <textarea
                    rows={3}
                    value={slot.contract?.criteria.join("\n") ?? ""}
                    onChange={(event) =>
                      patch(index, {
                        contract: { ...slot.contract!, criteria: event.target.value.split("\n") },
                      })
                    }
                    placeholder="一行一条，例如：预算每项都有来源"
                  />
                </label>
                <label className="qd-delivery-checkbox">
                  <input
                    type="checkbox"
                    checked={slot.contract?.required !== false}
                    onChange={(event) =>
                      patch(index, {
                        contract: { ...slot.contract!, required: event.target.checked },
                      })
                    }
                  />
                  项目或任务完成前必须交付
                </label>
                <details className="qd-delivery-extra">
                  <summary>说明与贡献来源</summary>
                  <label>
                    补充说明
                    <textarea
                      rows={2}
                      maxLength={2000}
                      value={slot.description ?? ""}
                      onChange={(event) => patch(index, { description: event.target.value })}
                    />
                  </label>
                  <label>
                    内容用途
                    <select
                      value={slot.contract?.purpose ?? "deliverable"}
                      onChange={(event) =>
                        patch(index, {
                          contract: {
                            ...slot.contract!,
                            purpose: event.target.value as "deliverable" | "project_spec",
                          },
                        })
                      }
                    >
                      <option value="deliverable">成果交付</option>
                      <option value="project_spec">项目规范的来源</option>
                    </select>
                  </label>
                  {Object.values(snap.collaboration?.goalPlans ?? {})
                    .flatMap((versions) => versions.at(-1)?.slots ?? [])
                    .filter((source) => !source.retired && source.id !== slot.id)
                    .map((source) => (
                      <label className="qd-delivery-checkbox" key={`${source.planId}:${source.id}`}>
                        <input
                          type="checkbox"
                          checked={slot.contributionIds?.includes(source.id) ?? false}
                          onChange={(event) =>
                            patch(index, {
                              contributionIds: event.target.checked
                                ? [...(slot.contributionIds ?? []), source.id]
                                : slot.contributionIds?.filter((id) => id !== source.id),
                            })
                          }
                        />
                        {source.title}
                      </label>
                    ))}
                </details>
              </div>
            ))}
            {["add", "replace", "split"].includes(operation) && (
              <button
                type="button"
                className="qd-link"
                onClick={() => {
                  setDrafts((values) => [...values, newSlot(contributionBindings[0]?.key ?? scopeKey)]);
                  invalidate();
                }}
              >
                <Icon name="plus" size={14} />
                再加一件
              </button>
            )}
          </fieldset>
        )}
        <label>
          调整原因
          <textarea
            disabled={busy}
            rows={2}
            maxLength={2000}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              invalidate();
            }}
            placeholder="说明新增需求、范围变化或取消原因"
          />
        </label>
        {preview && (
          <section className="qd-delivery-change-preview" aria-label="变更影响预览">
            <h3>
              核对后生效 · v{preview.result.baseVersion} → v{preview.result.nextVersion}
            </h3>
            <p>{reason}</p>
            <ul>
              {preview.result.slots
                .filter((slot) =>
                  [
                    ...preview.result.addedIds,
                    ...preview.result.changedIds,
                    ...preview.result.retiredIds,
                  ].includes(slot.id),
                )
                .map((slot) => (
                  <li key={slot.id}>
                    <span>
                      {preview.result.retiredIds.includes(slot.id)
                        ? "取消"
                        : preview.result.addedIds.includes(slot.id)
                          ? "新增"
                          : "修改"}
                    </span>
                    {slot.title}
                  </li>
                ))}
            </ul>
            <p>
              {preview.result.affectedTaskKeys.length} 个任务受影响 ·{" "}
              {preview.result.invalidatedArtifactIds.length} 份已有成果需要重新核对
            </p>
            <p>当前正式发布版本保留；本次调整会记录为新的清单版本。</p>
            {outdated && <p role="alert">清单已在别处更新，请重新预览。</p>}
          </section>
        )}
        {error && (
          <p className="qd-delivery-change-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer>
        <button type="button" className="qd-btn ghost" disabled={busy} onClick={onClose}>
          取消
        </button>
        {preview && !outdated ? (
          <button
            type="button"
            className="qd-btn primary"
            disabled={busy}
            onClick={() => void apply()}
          >
            {busy ? "正在保存…" : "确认变更"}
          </button>
        ) : (
          <button
            type="button"
            className="qd-btn primary"
            disabled={busy || !ready}
            onClick={() => void previewChanges()}
          >
            {busy ? "核对影响中…" : "预览变更"}
          </button>
        )}
      </footer>
    </dialog>,
    document.body,
  );
}
