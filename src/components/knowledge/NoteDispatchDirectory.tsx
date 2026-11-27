import { useEffect, useState } from "react";
import "./note-dispatch-directory.css";
import { desktopHost, type DesktopHost } from "../../integration/desktop";

type Preview = Awaited<ReturnType<NonNullable<DesktopHost["inspectTaskDirectory"]>>>;

export function likelySourceEdit(text: string) {
  if (/只(?:写|做|要|讨论).{0,5}(?:方案|文档|原型|规划|建议)/u.test(text)) return false;
  return /(?:修改|修复|重构|调整|升级|优化|改造|简化).{0,16}(?:源码|代码|客户端|界面|回执|帮你[记想管盯]|quandeck)|(?:源码|代码|客户端|界面|回执|帮你[记想管盯]|quandeck).{0,36}(?:修复|调整|重构|改造|简化|优化|需要支持)/iu.test(
    text,
  );
}

export function useDispatchDirectory(
  text: string,
  folder: string,
  projectId: string,
  agentId: string,
) {
  const inspect = desktopHost()?.inspectTaskDirectory;
  const [needsSource, setNeedsSource] = useState(() => likelySourceEdit(text));
  const [reviewed, setReviewed] = useState("");
  const [generation, refresh] = useState(0);
  const [result, setResult] = useState<{ key: string; value?: Preview; error?: string }>();
  const key = JSON.stringify([projectId, agentId, folder, generation]);
  useEffect(() => {
    if (!folder || !agentId || !inspect) return;
    let active = true;
    void inspect(folder, projectId, agentId).then(
      (value) => {
        if (active) setResult({ key, value });
      },
      () => {
        if (active) setResult({ key, error: "无法读取目录，请重新选择文件夹。" });
      },
    );
    return () => {
      active = false;
    };
  }, [folder, projectId, agentId, inspect, key]);
  const preview = result?.key === key ? result.value : undefined;
  const error = result?.key === key ? result.error : undefined;
  const blocked =
    !!desktopHost()?.chooseDirectory &&
    !!agentId &&
    needsSource &&
    (!folder ||
      (!!inspect &&
        (!preview || preview.empty || (!preview.sourceMarkers.length && reviewed !== key))));
  return {
    needsSource,
    setNeedsSource,
    preview,
    error,
    blocked,
    reviewed: reviewed === key,
    refresh: () => refresh((n) => n + 1),
    confirm: (checked: boolean) => setReviewed(checked ? key : ""),
  };
}

export function NoteDispatchDirectory({
  folder,
  custom,
  canChoose,
  creating,
  context,
  busy,
  choose,
  reset,
}: {
  folder: string;
  custom: boolean;
  canChoose: boolean;
  creating: boolean;
  context: ReturnType<typeof useDispatchDirectory>;
  busy: boolean;
  choose: () => void;
  reset: () => void;
}) {
  const { preview, error, needsSource, setNeedsSource } = context;
  return (
    <div
      className="qd-handoff-field qd-note-task-directory"
      role="group"
      aria-labelledby="qd-task-directory"
    >
      <span id="qd-task-directory">任务文件夹</span>
      <div className="qd-dispatch-directory">
        <span>{folder || "自动创建空文件夹"}</span>
        {canChoose && (
          <button type="button" className="qd-destination-toggle" disabled={busy} onClick={choose}>
            {folder ? "更换文件夹" : "使用已有文件夹"}
          </button>
        )}
        {custom && (
          <button type="button" className="qd-destination-toggle" disabled={busy} onClick={reset}>
            {creating ? "恢复自动分配" : "使用项目目录"}
          </button>
        )}
      </div>
      {preview && (
        <small className="qd-method-hint">
          {preview.empty
            ? "当前目录为空"
            : preview.entries.length
              ? "目录内容：" + preview.entries.join("、")
              : "目录下没有可预览的项目文件"}
        </small>
      )}
      {error && <small role="status">{error}</small>}
      {canChoose && (
        <label>
          <input
            type="checkbox"
            checked={needsSource}
            disabled={busy}
            onChange={(e) => setNeedsSource(e.target.checked)}
          />{" "}
          本次要修改已有产品源码
        </label>
      )}
      {needsSource && !folder && (
        <small role="status">请选择包含目标产品源码的文件夹，Agent 才能修改现有功能。</small>
      )}
      {needsSource && preview?.empty && (
        <small role="status">请选择包含目标产品源码的文件夹。</small>
      )}
      {needsSource && preview && !preview.empty && !preview.sourceMarkers.length && (
        <label>
          <input
            type="checkbox"
            disabled={busy}
            checked={context.reviewed}
            onChange={(e) => context.confirm(e.target.checked)}
          />{" "}
          已核对，目标源码在这个目录中
        </label>
      )}
    </div>
  );
}
