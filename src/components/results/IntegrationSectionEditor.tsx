import type { IntegrationSection, IntegrationSourcePin } from '../../data/resultIntegration';
import { Icon } from '../ui/Icon';

export function IntegrationSectionEditor({ section, index, count, sources, onChange, onMove, onRemove }: {
  section: IntegrationSection; index: number; count: number; sources: IntegrationSourcePin[];
  onChange: (section: IntegrationSection) => void; onMove: (offset: number) => void; onRemove: () => void;
}) {
  const set = (patch: Partial<IntegrationSection>) => onChange({ ...section, ...patch });
  const schedule = section.schedule;
  return <details className="qd-integration-section-editor" open={undefined}>
    <summary><span>{String(index + 1).padStart(2, '0')}</span><strong>{section.title || '未命名章节'}</strong><small>{schedule?.date ?? `${section.sourceIds.length} 份来源`}</small><Icon name="chevron-down" size={13} /></summary>
    <div className="qd-integration-section-fields">
      <label>章节标题<input value={section.title} maxLength={300} onChange={e => set({ title: e.target.value })} /></label>
      <label>内容<textarea value={section.body} rows={7} onChange={e => set({ body: e.target.value })} /></label>
      <fieldset><legend>采用的来源</legend><div className="qd-integration-source-chips">{sources.map(source => <label key={source.artifactId}><input type="checkbox" checked={section.sourceIds.includes(source.artifactId)} onChange={e => set({ sourceIds: e.target.checked ? [...section.sourceIds, source.artifactId] : section.sourceIds.filter(id => id !== source.artifactId) })} />{source.title}</label>)}</div></fieldset>
      <details className="qd-integration-section-extra"><summary>日期、时段与共用约束</summary>
        <label>日期<input type="date" value={schedule?.date ?? ''} onChange={e => set({ schedule: e.target.value ? { ...schedule, date: e.target.value } : undefined })} /></label>
        {schedule && <div className="qd-integration-time-fields"><label>开始时间<input type="time" value={schedule.start ?? ''} onChange={e => set({ schedule: { ...schedule, start: e.target.value || undefined } })} /></label><label>结束时间<input type="time" value={schedule.end ?? ''} onChange={e => set({ schedule: { ...schedule, end: e.target.value || undefined } })} /></label><label>同行者 / 资源<input placeholder="如：全家、租车" value={schedule.resource ?? ''} onChange={e => set({ schedule: { ...schedule, resource: e.target.value || undefined } })} /></label></div>}
        <p className="qd-integration-muted">时段可留空；相同资源的重叠安排会被标记。</p>
        <div className="qd-integration-fact-editors">{section.facts?.map((fact, i) => <div key={i}><input aria-label={`共用约束${i + 1}名称`} placeholder="如：总预算（CNY）" value={fact.key} onChange={e => set({ facts: section.facts!.map((f, n) => n === i ? { ...f, key: e.target.value } : f) })} /><input aria-label={`共用约束${i + 1}内容`} placeholder="如：8000" value={fact.value} onChange={e => set({ facts: section.facts!.map((f, n) => n === i ? { ...f, value: e.target.value } : f) })} /><button type="button" aria-label={`删除共用约束${i + 1}`} onClick={() => set({ facts: section.facts!.filter((_, n) => n !== i) })}><Icon name="close" size={14} /></button></div>)}</div>
        <button type="button" className="qd-link" onClick={() => set({ facts: [...(section.facts ?? []), { key: '', value: '' }] })}>添加共用约束</button><p className="qd-integration-muted">同名约束应一致；分日条件请在名称中写明日期。</p>
      </details>
      <div className="qd-integration-section-tools"><button type="button" disabled={index === 0} onClick={() => onMove(-1)}>上移</button><button type="button" disabled={index === count - 1} onClick={() => onMove(1)}>下移</button><button type="button" onClick={onRemove}>移除章节</button></div>
    </div>
  </details>;
}
