import { useEffect, useRef, useState } from "react";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { Popover } from "../ui/Popover";
import { IntakeFeedback } from './IntakeFeedback';
import './intake.css';
import { checkPendingFiles } from '../workspace/TaskAttachments';
import { saveOutputFile, removeOutputFile, fileSize } from '../../data/outputFiles';
import type { OutputAttachment } from '../../data/types';

type InputMode = 'intelligent' | 'manual' | 'text';
const modes: { value: InputMode; label: string; hint: string }[] = [
  { value: 'intelligent', label: 'AI 识别', hint: '请 Agent 理解需求并建立待办' },
  { value: 'manual', label: '新任务', hint: '直接创建任务，再补充要求'  },
  { value: 'text', label: '随手记', hint: '记录一段文字'  },
];

/** 原有输入区：智能分拣与明确的人工创建共享现有任务池。 */
export function Composer() {
  const { snap, api, toast, openWorkspace } = useWorkdeck();
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const filePicker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<InputMode>('manual');
  const [modeOpen, setModeOpen] = useState(false);
  const [error, setError] = useState('');
  const [savedBeforeError, setSavedBeforeError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 演示菜单可预填一句想法
  useEffect(() => {
    const fill = (e: Event) => {
      setValue((e as CustomEvent<string>).detail);
      setError('');
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    const focus = () => { setMode('manual'); inputRef.current?.focus(); };
    window.addEventListener("quandeck:prefill", fill);
    window.addEventListener("quandeck:new-task", focus);
    return () => { window.removeEventListener("quandeck:prefill", fill); window.removeEventListener("quandeck:new-task", focus); };
  }, []);

  const createWithFiles = async (text: string) => {
    const projectId = snap.project.id, created: OutputAttachment[] = [];
    try {
      checkPendingFiles(files);
      for (const file of files) created.push(await saveOutputFile(projectId, file));
      const result = await api.createTaskWithAttachments(text, created, projectId);
      if (!result.ok || !result.taskId) throw new Error(result.message ?? '任务附件未能保存');
      setFiles([]); setValue('');
      return result.taskId;
    } catch (cause) {
      await Promise.all(created.map(file => removeOutputFile(projectId, file.id).catch(() => {})));
      throw cause;
    }
  };

  /** 复杂想法：准备交给 Agent 讨论；只保存事项，不派发或本地模拟回复 */
  const think = async () => {
    const raw = value.trim();
    if (!raw || busy) return;
    setBusy(true); setError(''); setSavedBeforeError(false);
    let saved = false;
    try {
      const taskId = files.length ? await createWithFiles(raw) : (await api.createIdea(raw)).taskId;
      saved = true;
      if (files.length) await api.ensureTaskPlan(taskId);
      setValue("");
      openWorkspace(taskId, { view: "plan", pane: "side" });
    } catch (cause) {
      setSavedBeforeError(saved);
      setError(saved ? '任务已保存，但暂时无法打开讨论，请从任务中重试。' : `${cause instanceof Error ? cause.message : '未能保存想法'}；内容已保留，请重试。`);
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    const raw = value.trim();
    if (!raw || busy) return;
    const explicitTask = mode !== 'text' && /^(\[\s?\]|-\s\[\s?\])\s*/.test(raw);
    const text = explicitTask ? raw.replace(/^(\[\s?\]|-\s\[\s?\])\s*/, '') : value;
    if (!text.trim()) return;
    setBusy(true); setError(''); setSavedBeforeError(false);
    try {
      if (files.length) {
        const taskId = await createWithFiles(text);
        if (mode === 'intelligent') void api.summarizeTaskTitle(taskId, snap.project.id).catch(() => {});
        toast('任务与附件已保存');
      } else if (mode === 'intelligent' && !explicitTask) {
        const result = await api.submitIntake(value, snap.project.id);
        if (!result.ok) throw new Error(result.message || '原始输入未能保存，请重试');
      } else {
        await api.addBlock(mode === 'text' ? 'text' : 'task', text);
        toast(mode === 'text' ? '已记入日记' : '任务已创建 · 点击标题补充要求，或拖给 Agent 执行');
      }
      setValue("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能保存');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <form
      className="qd-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="qd-intake-switcher"><button
        type="button"
        className={`qd-mode ${mode !== 'text' ? 'is-todo' : ''}`}
        onClick={() => setModeOpen(current => !current)}
        aria-haspopup="dialog"
        aria-expanded={modeOpen}
        aria-label={`输入方式：${modes.find(item => item.value === mode)!.label}`}
        title="选择新任务、AI 识别或随手记"
      >
        <Icon name={mode === 'text' ? 'pencil' : 'check-square'} size={17} />
        <span>{modes.find(item => item.value === mode)!.label}</span><Icon name="chevron-down" size={12} />
      </button><Popover open={modeOpen} onClose={() => setModeOpen(false)} label="选择输入方式" align="left" className="qd-intake-modes">
        {modes.map(item => <button type="button" key={item.value} disabled={item.value === 'text' && files.length > 0} title={item.value === 'text' && files.length ? '移除待上传附件后可改为文字' : undefined} aria-pressed={mode === item.value} onClick={() => { setMode(item.value); setModeOpen(false); requestAnimationFrame(() => inputRef.current?.focus()); }}><span><strong>{item.label}</strong><small>{item.hint}</small></span>{mode === item.value && <Icon name="check" size={14} />}</button>)}
      </Popover></div>
      <input
        ref={inputRef}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (!e.nativeEvent.isComposing && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            think();
          }
        }}
        placeholder={mode === 'text' ? '记下想法，或交给 Agent 讨论…' : mode === 'manual' ? '输入任务标题' : '添加需求，例如：整理旅行攻略'}
        aria-label="记录想法或输入任务"
      />
      <input type="file" multiple hidden ref={filePicker} aria-label="选择新任务附件" onChange={event => { const selected = Array.from(event.target.files ?? []); event.target.value = ''; setSavedBeforeError(false); try { checkPendingFiles([...files, ...selected]); setFiles(current => [...current, ...selected]); setError(''); if (mode === 'text') setMode('manual'); } catch (cause) { setError(cause instanceof Error ? cause.message : '文件无法添加'); } }} />
      <button type="button" className="qd-icon-btn" disabled={busy} aria-label="添加任务附件" title="添加任务附件（每个最多 25 MB）" onClick={() => filePicker.current?.click()}><Icon name="folder" size={16} /></button>
        <button type="button" className="qd-think" disabled={!value.trim() || busy} onClick={think} title="可选：先定方向，再拆成任务（⌘/Ctrl + 回车）">
          <Icon name="message" size={15} />
          先讨论方向
        </button>
      <button type="submit" className="qd-enter" disabled={!value.trim() || busy}>
        <Icon name="enter" size={15} />
        {busy ? '保存中…' : mode === 'manual' ? '创建任务' : mode === 'text' ? '记下' : '识别'}
      </button>
    </form>
    {!!files.length && <div className="qd-composer-files" aria-label="待上传附件">{files.map((file,index) => <span key={`${file.name}:${index}`}><Icon name="folder" size={12} /><span className="qd-file-name" title={file.name}>{file.name}</span><small>{fileSize(file.size)}</small><button type="button" className="qd-icon-btn" disabled={busy} aria-label={`移除待上传附件 ${file.name}`} onClick={() => setFiles(current => current.filter((_,i) => i !== index))}><Icon name="close" size={12} /></button></span>)}</div>}
    {error && <details className="qd-intake-local-error" role="alert"><summary>{savedBeforeError ? '任务已保存 · 讨论未打开' : '未保存 · 输入已保留'}</summary><p>{error}</p></details>}
    {!!snap.intelligence?.intakes.length && <details className="qd-input-history"><summary>查看之前的输入记录</summary><IntakeFeedback onManualMode={() => { setMode('manual'); setModeOpen(false); inputRef.current?.focus(); }} /></details>}
  </>;
}
