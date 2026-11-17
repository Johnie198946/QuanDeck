import { SpecLineagePanel } from "./SpecLineagePanel";
import { useRef, useState } from 'react';
import { DELIVERY_STATE, deliveryPresentation, deliverySlotDepth, deliverySlotEntry, deliverySlotKey, type DeliveryScope } from '../../data/deliveryPresentation';
import { resultTime } from '../../data/results';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import { TaskOutputButton } from '../outputs/OutputDialog';
import { ResultDocument } from './ResultDocument';
import { useResultResize } from './useResultResize';
import './delivery-map.css';

export function DeliveryMap({ scope = {} }: { scope?: DeliveryScope }) {
  const { snap, openWorkspace, openSourceSession, openProjectDirection } = useWorkdeck();
  const view = deliveryPresentation(snap, scope);
  const [selected, setSelected] = useState('');
  const [historyId, setHistoryId] = useState('');
  const reader = useRef<HTMLDivElement>(null);
  const resizeRef = useResultResize();
  const slot = !historyId ? view.slots.find(item => deliverySlotKey(item) === selected) ?? view.slots[0] : undefined;
  const historical = view.history.find(item => item.entry.record.id === historyId) ?? (!view.slots.length ? view.history[0] : undefined);
  const report = historical?.entry ?? (slot ? deliverySlotEntry(snap, slot) : null);
  const taskId = slot?.taskId ?? historical?.taskId;
  const itemId = slot?.workItemId ?? historical?.entry.record.itemId;
  const task = taskId ? snap.tasks[taskId] : undefined;
  const child = taskId && itemId ? snap.orchestrations?.[taskId]?.items[itemId] : undefined;
  const plan = slot && view.plans.find(item => item.id === slot.planId);
  const candidates = view.slots.filter(item => item.state === 'candidate').length;
  const revisions = view.slots.filter(item => ['changes_requested', 'stale'].includes(item.state)).length;
  const missing = view.slots.filter(item => ['empty', 'running', 'blocked'].includes(item.state)).length;
  const select = (key: string, history = false) => {
    setSelected(history ? '' : key); setHistoryId(history ? key : '');
    if (matchMedia('(max-width: 760px)').matches) requestAnimationFrame(() => {
      reader.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      reader.current?.focus({ preventScroll: true });
    });
  };
  const openTaskResults = () => task && openWorkspace(task.id, { view: 'results', selected: itemId ?? null, itemId: itemId ?? null, focus: true });
  return <section ref={resizeRef} className="qd-delivery-map" aria-label={scope.taskId ? '任务交付地图' : '项目交付地图'}>
    <header className="qd-map-summary">
      <div><span className="qd-map-eyebrow">{view.slots.length ? '交付逐步就位' : '已有成果'}</span><h2>{view.total ? `${view.accepted} / ${view.total} 个章节已认可` : view.history.length ? `${view.history.length} 份真实交付` : '先确定要交付什么'}</h2><p>{view.total ? '任务交付后自动出现在对应章节，留白的位置继续保留。' : view.history.length ? '历史内容与原文件保留在这里。确定新的交付方向后，会按章节汇集。' : '方案确定的交付章节会出现在这里，完成一部分，就能阅读一部分。'}</p></div>
      {!!view.total && <dl className="qd-map-counts"><div><dt>候选</dt><dd>{candidates}</dd></div><div><dt>待补齐</dt><dd>{missing}</dd></div><div><dt>待修改</dt><dd>{revisions}</dd></div></dl>}
    </header>
    <SpecLineagePanel taskKey={slot?.taskKey} artifactId={slot?.artifact?.id} />
    {!view.total && !scope.taskId && <button type="button" className="qd-map-direction-button" onClick={() => openProjectDirection(snap.project.id)}>确定项目方向<Icon name="arrow-right" size={14} /></button>}
    {!!view.slots.length && <nav className="qd-map-strip" aria-label="交付全貌">{view.slots.map((item, index) => <button type="button" key={deliverySlotKey(item)} className={`state-${item.state}`} aria-label={`第 ${index + 1} 章 ${item.title}：${DELIVERY_STATE[item.state]}`} aria-pressed={slot?.id === item.id && slot.planId === item.planId} onClick={() => select(deliverySlotKey(item))}><span>{String(index + 1).padStart(2, '0')}</span><i /></button>)}</nav>}
    {(view.slots.length > 0 || view.history.length > 0) && <div className="qd-map-layout">
      <nav className="qd-map-index" aria-label="成果章节">
        {!!view.slots.length && <><h3>章节地图 <span>{view.total}</span></h3><ol>{view.slots.map((item, index) => <li key={deliverySlotKey(item)} className={`depth-${deliverySlotDepth(item, view.slots)}`}>
          <button type="button" className={`state-${item.state}`} data-delivery-slot={item.id} data-delivery-plan={item.planId} data-state={item.state} aria-current={slot?.id === item.id && slot.planId === item.planId ? 'true' : undefined} onClick={() => select(deliverySlotKey(item))}>
            <span className="qd-map-number">{String(index + 1).padStart(2, '0')}</span><span className="qd-map-chapter-title"><strong>{item.title}</strong><small><i />{DELIVERY_STATE[item.state]}</small></span><Icon name={item.artifact ? 'chevron-right' : 'dot'} size={14} />
          </button>
        </li>)}</ol></>}
        {!!view.history.length && <div className="qd-map-history"><h3>{view.slots.length ? '其他已有成果' : '交付记录'} <span>{view.history.length}</span></h3><p>{view.slots.length ? '保留未归入当前章节的历史交付。' : '点开阅读正文与附件。'}</p><ol>{view.history.map(item => <li key={item.entry.record.id}><button type="button" aria-current={historical?.entry.record.id === item.entry.record.id ? 'true' : undefined} onClick={() => select(item.entry.record.id, true)}><Icon name="folder" size={15} /><span><strong>{item.entry.record.title}</strong><small>{item.taskTitle} · {item.entry.status}</small></span></button></li>)}</ol></div>}
      </nav>
      <div ref={reader} tabIndex={-1} className="qd-map-reader" data-delivery-slot={slot?.id} data-delivery-plan={slot?.planId} data-state={slot?.state} aria-label="选中章节内容">
        <header className="qd-map-reader-context"><div><span>{historical ? '已有交付' : plan?.title ?? '交付章节'}</span><strong>{slot?.title ?? historical?.entry.record.title}</strong></div>{slot && <span className={`qd-map-state state-${slot.state}`}><i />{DELIVERY_STATE[slot.state]}</span>}</header>
        {slot && <div className="qd-map-origin"><span>来自 {task?.title ?? '原任务'}{child && <> / {child.title}</>}</span>{!scope.taskId && task && <button type="button" onClick={openTaskResults}>任务成果汇总<Icon name="arrow-right" size={12} /></button>}{slot.sourceSessionId && <button type="button" onClick={() => openSourceSession(slot.sourceSessionId!)}>来源会话<Icon name="external" size={12} /></button>}</div>}
        {slot?.description && <p className="qd-map-expectation">{slot.description}</p>}
        {slot?.missingReason && <p className={`qd-map-reason state-${slot.state}`} role="status"><Icon name={slot.artifact ? 'alert' : 'clock'} size={16} />{slot.missingReason}</p>}
        {report && taskId ? <ResultDocument key={`${slot ? deliverySlotKey(slot) : 'history'}:${report.record.id}`} entry={report} taskId={taskId} statusLabel={slot ? DELIVERY_STATE[slot.state] : undefined} /> : slot ? <section className="qd-map-empty-slot" aria-label={`${slot.title}尚无成果`}><span className="qd-map-empty-mark" aria-hidden="true"><Icon name="folder" size={28} /></span><h2>{slot.title}，这里先留白</h2><p>{slot.state === 'running' ? '对应任务正在执行，收到真实交付后会自动填入。' : slot.state === 'blocked' ? '完成缺少的条件后，对应任务可以继续。' : '还没有与这个章节对应的交付内容。'}</p><div className="qd-map-empty-line" /><small>章节已保留 · 不用手动拼接</small>{task && <TaskOutputButton taskId={task.id} itemId={itemId} />}</section> : null}
        {historical && <p className="qd-map-history-note">{historical.taskTitle} · {resultTime(historical.entry.record.at)}。此记录不会替代当前章节的待交付位置。</p>}
      </div>
    </div>}
  </section>;
}
