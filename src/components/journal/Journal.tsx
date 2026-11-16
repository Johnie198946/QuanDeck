import { useEffect, useState } from "react";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Composer } from "./Composer";
import { SuggestionNotice } from './SuggestionNotice';
import { SessionEntry } from "./SessionEntry";
import { TaskRow } from "./TaskRow";
import { TextBlock } from "./TextBlock";
import { MergeCollapseSlot } from "./MergeFx";
import { usePreferences } from "../../state/preferences";
import { taskView } from "../../data/derive";
import { Icon } from "../ui/Icon";
import type { LogDensity } from "../../state/preferences";
import './session-log.css';

function InlineEditable({
  value,
  onSave,
  className,
  label,
  as: Tag,
}: {
  value: string;
  onSave: (v: string) => void;
  className: string;
  label: string;
  as: "h1" | "p";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const save = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) onSave(v);
    else setDraft(value);
  };
  if (editing)
    return (
      <input
        className={`${className} qd-inline-input`}
        value={draft}
        autoFocus
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  return (
    <Tag
      className={`${className} qd-editable`}
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => e.key === "Enter" && setEditing(true)}
      title="点击编辑"
    >
      {value}
    </Tag>
  );
}

export function Journal() {
  const {preferences,update} = usePreferences();
  const { snap, api, mergeFx, drag, setDrag, toast, locateTask } = useWorkdeck();
  // 关联成功后，源行在原位置留一个收起中的占位
  const slot =
    mergeFx?.snapshot &&
    !snap.journal.blocks.some((b) => b.kind === "session" && b.sessionId === mergeFx.sessionId)
      ? mergeFx
      : null;
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all');
  const taskBlocks = snap.journal.blocks.filter(block => block.kind === 'task' && snap.tasks[block.taskId]);
  const completeCount = taskBlocks.filter(block => block.kind === 'task' && taskView(snap, snap.tasks[block.taskId]) === 'done').length;
  const visibleBlocks = snap.journal.blocks.filter(block => block.kind !== 'task' || !snap.tasks[block.taskId] || filter === 'all' || (taskView(snap, snap.tasks[block.taskId]) === 'done') === (filter === 'done'));
  const newTask = () => window.dispatchEvent(new CustomEvent('quandeck:new-task'));

  return (
    <section className="qd-journal" aria-label="项目任务">
      <div className="qd-journal-scroll">
        <div className="qd-journal-inner">
          <header className="qd-project-heading">
            <div><p className="qd-project-eyebrow">项目工作台 <span>／</span> {snap.dateLabel}</p><h1 className="qd-page-title">{snap.project.name}</h1>{snap.project.description && <p className="qd-project-description">{snap.project.description}</p>}</div>
            <button type="button" className="qd-btn primary qd-new-task" onClick={newTask}><Icon name="plus" size={16}/>新任务</button>
          </header>
          <div className="qd-project-toolbar">
            <nav aria-label="任务筛选">{([['all', '全部任务', taskBlocks.length], ['active', '待推进', taskBlocks.length - completeCount], ['done', '已完成', completeCount]] as const).map(([key, label, count]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<span>{count}</span></button>)}</nav>
            <details className="qd-project-options"><summary>显示选项</summary><label className="qd-log-density">执行记录<select aria-label="执行记录密度" value={preferences.logDensity} onChange={e=>update({logDensity:e.target.value as LogDensity})}><option value="brief">简略</option><option value="standard">标准</option><option value="detailed">详细</option></select></label><InlineEditable as="p" className="qd-summary" label="编辑项目笔记" value={snap.journal.summary || '添加项目笔记'} onSave={summary => api.updateJournal({summary})}/></details>
          </div>
          <SuggestionNotice />

          <div className="qd-blocks">
            {slot && slot.afterBlockId === null && <MergeCollapseSlot key={slot.key} fx={slot} />}
            {visibleBlocks.map((b) => {
              const node =
                b.kind === "text" ? (
                  <TextBlock key={b.id} blockId={b.id} text={b.text} />
                ) : b.kind === "task" ? (
                  <TaskRow key={b.id} taskId={b.taskId} />
                ) : (
                  <SessionEntry key={b.id} sessionId={b.sessionId} />
                );
              return slot && slot.afterBlockId === b.id
                ? [node, <MergeCollapseSlot key={`slot-${slot.key}`} fx={slot} />]
                : node;
            })}
            {visibleBlocks.length === 0 && (
              <div className="qd-empty">
                {filter === 'done' ? '完成的任务会收在这里。' : '添加一个任务，写清需求，再交给 Agent。'}
              </div>
            )}
            {drag?.type === 'session' && <div className="qd-empty" role="region" aria-label="放开会话新建任务"
              style={{ border: '1px dashed var(--qd-border, #c7cbd1)', borderRadius: 8, padding: 20 }}
              onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'link'; }}
              onDrop={async event => { event.preventDefault(); const sessionId = drag.sessionId; setDrag(null); try { const result = await api.createTaskFromSession(sessionId); if (result.ok && result.taskId) locateTask(result.taskId); else toast(result.message ?? '关联失败', 'error'); } catch (error) { toast(error instanceof Error ? error.message : '关联失败', 'error'); } }}>放到这里，新建关联任务</div>}
          </div>
        </div>
      </div>
      <div className="qd-composer-wrap">
        <Composer />
      </div>
    </section>
  );
}
