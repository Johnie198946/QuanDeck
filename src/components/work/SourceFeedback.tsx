import { useEffect, useId, useRef } from "react";
import type { SourceOpenResult } from "../../integration/contracts";
import { Icon } from "../ui/Icon";

export function SourceFeedback({ result, title, onClose, onConnect }: {
  result: SourceOpenResult; title: string; onClose(): void; onConnect(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { ref.current?.close(); trigger?.focus(); };
  }, []);
  return <dialog className="qd-discussion-dialog qd-source-feedback" ref={ref} aria-labelledby={id} onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><h2 id={id}>{result.status === "parent_opened" ? "已打开主会话" : "打开 Agent 会话"}</h2><button type="button" className="qd-icon-btn" onClick={onClose} aria-label="关闭"><Icon name="close" size={18} /></button></header>
    <p className="qd-dialog-description"><strong>{title}</strong></p>
    <p className="qd-dialog-description">{result.message}</p>
    {result.childCallId && <p className="qd-dialog-description">子代理调用：<code>{result.childCallId}</code>。可在主会话中查找此调用。</p>}
    {result.requestId && <p className="qd-dialog-description">请在源会话中回复或授权，这里会等待源端回执更新。</p>}
    <footer><button type="button" className="qd-btn ghost" onClick={onClose}>关闭</button>{result.status === "unavailable" && <button type="button" className="qd-btn primary" onClick={onConnect}>连接 Agent</button>}</footer>
  </dialog>;
}
