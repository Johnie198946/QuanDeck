import { useEffect, useState } from 'react';
import type { IntegrationCommand, IntegrationInspection, IntegrationSource, IntegrationSection } from '../../data/resultIntegration';
import { IntegrationSectionEditor } from './IntegrationSectionEditor';
import { Icon } from '../ui/Icon';

export function IntegrationEditor({ inspection, sources, busy, onSave, onDirty }: {
  inspection: IntegrationInspection; sources: IntegrationSource[]; busy: boolean;
  onSave: (revision: number, payload: IntegrationCommand['payload']) => Promise<boolean>;
  onDirty: (dirty: boolean) => void;
}) {
  const latest = inspection.revision;
  const [base, setBase] = useState(latest);
  const [title, setTitle] = useState(latest.title);
  const [sections, setSections] = useState(latest.sections);
  const [sourceIds, setSourceIds] = useState(latest.sourcePins.map(source => source.artifactId));
  const [excludeReasons, setExcludeReasons] = useState<Record<string,string>>({});
  const [dirty, setDirty] = useState(false);
  const change = () => { setDirty(true); onDirty(true); };
  const reset = () => { setBase(latest); setTitle(latest.title); setSections(latest.sections); setSourceIds(latest.sourcePins.map(source => source.artifactId)); setExcludeReasons({}); setDirty(false); onDirty(false); };
  useEffect(() => { if (!dirty && base.id !== latest.id) reset(); }, [latest.id, dirty]);
  const pins = [...base.sourcePins, ...sources.filter(source => !base.sourcePins.some(pin => pin.artifactId === source.artifactId))];
  const chosen = pins.filter(pin => sourceIds.includes(pin.artifactId));
  const staleEditor = base.id !== latest.id;
  const save = async () => {
    if (await onSave(base.revision, { title, sections, sourceIds, excludeReasons })) { setDirty(false); onDirty(false); }
  };
  const selectSource = (source: IntegrationSource, selected: boolean) => {
    change();
    setSourceIds(selected ? [...sourceIds, source.artifactId] : sourceIds.filter(id => id !== source.artifactId));
    if (selected && !sections.some(section => section.sourceIds.includes(source.artifactId))) setSections([...sections, { id: crypto.randomUUID(), title: source.title, body: source.body, sourceIds: [source.artifactId] }]);
  };
  return <section className="qd-integration-editor" aria-label="编排完整成果">
    {staleEditor && <div className="qd-integration-notice" role="alert">草稿已有新改动，你的输入仍保留。<button type="button" onClick={reset}>放弃本地编辑，载入新稿</button></div>}
    <label className="qd-integration-title-field">成果标题<input value={title} onChange={e => { setTitle(e.target.value); change(); }} maxLength={300} /></label>
    <details className="qd-integration-source-picker"><summary>采用来源 · {sourceIds.length} 份</summary><div>{sources.map(source => <label key={source.artifactId}><input type="checkbox" checked={sourceIds.includes(source.artifactId)} disabled={!source.eligible && !sourceIds.includes(source.artifactId)} onChange={e => selectSource(source, e.target.checked)} /><span><strong>{source.title}</strong><small>{source.taskTitle}{!source.eligible && ` · ${source.reasons.join('；')}`}</small></span></label>)}{base.sourcePins.filter(pin => !sourceIds.includes(pin.artifactId)).map(pin => <label className="qd-integration-exclusion" key={pin.artifactId}>移除“{pin.title}”的原因<input value={excludeReasons[pin.artifactId] ?? ''} onChange={e => { setExcludeReasons({ ...excludeReasons, [pin.artifactId]: e.target.value }); change(); }} placeholder="说明不再采用的原因" /></label>)}</div></details>
    <div className="qd-integration-editor-heading"><h3>章节编排</h3><span>{sections.length} 章</span></div>
    {sections.map((section, index) => <IntegrationSectionEditor key={section.id} section={section} index={index} count={sections.length} sources={chosen} onChange={next => { change(); setSections(sections.map(s => s.id === next.id ? next : s)); }} onMove={offset => { change(); const next = [...sections]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; setSections(next); }} onRemove={() => { change(); setSections(sections.filter(s => s.id !== section.id)); }} />)}
    <button type="button" className="qd-link qd-integration-add-section" onClick={() => { change(); setSections([...sections, { id: crypto.randomUUID(), title: '新章节', body: '', sourceIds: [] }]); }}><Icon name="plus" size={14} />添加章节</button>
    <footer className="qd-integration-editor-footer"><span>{dirty ? '有未保存修改' : `已保存 · 草稿 ${latest.revision}`}</span><button type="button" className="qd-btn primary small" disabled={busy || !dirty || staleEditor} onClick={() => void save()}>{busy ? '保存中…' : '保存并校验'}</button></footer>
  </section>;
}
