import { useState } from 'react';
import { inspectIntegration, inspectIntegrationVersion, listIntegrationSources, integrationMarkdown, type IntegrationCommand, type IntegrationChoice, type IntegrationSource } from '../../data/resultIntegration';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { IntegrationReader } from './IntegrationReader';
import { IntegrationEditor } from './IntegrationEditor';
import { IntegrationChecks } from './IntegrationChecks';
import { Icon } from '../ui/Icon';
import './integration.css';

export function ResultsIntegration() {
  const { snap, api, toast } = useWorkdeck();
  const state = snap.integration;
  const sources = listIntegrationSources(snap);
  const bundles = Object.values(state?.bundles ?? {}).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [selectedBundle, setSelectedBundle] = useState('');
  const [selectedDraft, setSelectedDraft] = useState('');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const bundle = bundles.find(item => item.id === selectedBundle) ?? bundles[0];
  const versions = state?.versions.filter(version => version.bundleId === bundle?.id).sort((a, b) => b.version - a.version) ?? [];
  const version = versions.find(item => item.id === selectedVersion) ?? versions[0];
  const drafts = Object.values(state?.drafts ?? {}).filter(draft => draft.bundleId === bundle?.id && draft.status === 'draft');
  const draft = drafts.find(item => item.id === selectedDraft) ?? drafts.at(-1);
  const inspection = draft ? inspectIntegration(snap, draft.id) : undefined;
  const isEditor = !!inspection && (editing || !version);
  const send = async (command: Omit<IntegrationCommand, 'projectId' | 'idempotencyKey'>) => {
    setBusy(true);
    try { const result = await api.integrate({ ...command, projectId: snap.project.id, idempotencyKey: crypto.randomUUID() }); if (!result.ok) throw new Error(result.message || '操作未完成'); return result; }
    catch (cause) { toast(cause instanceof Error ? cause.message : '操作未完成', 'error'); return null; }
    finally { setBusy(false); }
  };
  const create = async (title: string, sourceIds: string[]) => {
    const result = await send({ type: 'create', payload: { title, sourceIds } });
    if (result) { setSelectedBundle(result.bundleId!); setSelectedDraft(result.draftId!); setSelectedVersion(''); setCreating(false); setEditing(true); setDirty(false); }
  };
  const branch = async () => {
    if (!bundle || !version) return;
    const result = await send({ type: 'create', payload: { bundleId: bundle.id, baseVersionId: version.id } });
    if (result) { setSelectedDraft(result.draftId!); setEditing(true); setPreview(false); setDirty(false); }
  };
  const save = async (revision: number, payload: IntegrationCommand['payload']) => !!await send({ type: 'save', draftId: draft!.id, expectedRevision: revision, payload });
  const rebase = async (choices: Record<string, IntegrationChoice>) => { if (inspection) await send({ type: 'rebase', draftId: draft!.id, expectedRevision: draft!.revision, payload: { choices, expectedBundleVersion: inspection.bundle.version } }); };
  const publish = async (note: string) => {
    if (!inspection) return;
    const result = await send({ type: 'publish', draftId: draft!.id, expectedRevision: draft!.revision, payload: { expectedBundleVersion: inspection.bundle.version, reviewed: true, reviewNote: note } });
    if (result) { setSelectedVersion(result.versionId!); setEditing(false); setDirty(false); setPreview(false); toast(`已发布 · ${inspection.revision.title}`); }
  };
  const download = (json = false) => {
    if (!version) return;
    const text = json ? JSON.stringify(version, null, 2) : integrationMarkdown(snap, version.id);
    const url = URL.createObjectURL(new Blob([text], { type: json ? 'application/json' : 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${version.title.replace(/[\\/:*?"<>|]/g, '_')}-v${version.version}.${json ? 'json' : 'md'}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="qd-integration" aria-label="完整成果">
    <header className="qd-integration-heading"><div><h2>把各项结果，连成完整成果</h2><p>保留来源，核对交叉影响，按版本发布。</p></div><button type="button" className="qd-btn primary small" disabled={busy || dirty} onClick={() => setCreating(value => !value)}><Icon name="plus" size={14} />新建整合</button></header>
    {(creating || !bundles.length) && <IntegrationCreate sources={sources} busy={busy} onCreate={create} />}
    {!!bundles.length && <nav className="qd-integration-bundles" aria-label="选择完整成果">{bundles.map(item => <button key={item.id} type="button" disabled={dirty} aria-pressed={bundle?.id === item.id} onClick={() => { setSelectedBundle(item.id); setSelectedDraft(''); setSelectedVersion(''); setEditing(false); setPreview(false); }}><Icon name="merge" size={14} /><span>{item.title}</span><small>{item.version ? `v${item.version}` : '草稿'}</small></button>)}</nav>}
    {bundle && <div className="qd-integration-toolbar"><div className="qd-integration-actions">{version && <button type="button" aria-pressed={!isEditor} disabled={dirty} onClick={() => setEditing(false)}>阅读成果</button>}{draft && <button type="button" aria-pressed={isEditor} onClick={() => setEditing(true)}>编排草稿{drafts.length > 1 ? ` · ${drafts.length}` : ''}</button>}{isEditor && drafts.length > 1 && <select aria-label="选择整合草稿" value={draft?.id} disabled={dirty} onChange={e => setSelectedDraft(e.target.value)}>{drafts.map((item, i) => <option key={item.id} value={item.id}>草稿 {i + 1} · 修订 {item.revision}</option>)}</select>}</div><div className="qd-integration-actions">{isEditor ? <button type="button" disabled={dirty} onClick={() => setPreview(value => !value)}>{preview ? '返回编辑' : '预览已保存稿'}</button> : version && <><select aria-label="查看成果版本" value={version.id} onChange={e => setSelectedVersion(e.target.value)}>{versions.map(item => <option key={item.id} value={item.id}>v{item.version}{item.id === bundle.publishedVersionId ? ' · 当前' : ''}</option>)}</select><button type="button" disabled={busy} onClick={() => void branch()}>从此版本编辑</button><button type="button" onClick={() => download()}>导出 Markdown</button><button type="button" onClick={() => download(true)}>JSON</button></>}</div></div>}
    {isEditor && inspection ? <div className="qd-integration-workspace"><div>{preview ? <IntegrationReader content={inspection.revision} /> : <IntegrationEditor key={draft!.id} inspection={inspection} sources={sources} busy={busy} onSave={save} onDirty={setDirty} />}</div><IntegrationChecks key={`${inspection.revision.id}:${inspection.bundle.version}`} inspection={inspection} busy={busy} dirty={dirty} onRebase={rebase} onPublish={publish} /></div> : version && <>{inspectIntegrationVersion(snap, version.id)?.issues.some(issue => issue.severity === 'blocking') && <div className="qd-integration-notice" role="status">来源已有变化，此版保留发布时的内容。<details><summary>查看影响</summary>{inspectIntegrationVersion(snap, version.id)?.issues.filter(issue => issue.severity === 'blocking').map(issue => <p key={issue.id}>{issue.message}</p>)}</details></div>}<IntegrationReader content={version} version={version.version} at={version.at} /></>}
  </section>;
}

function IntegrationCreate({ sources, busy, onCreate }: { sources: IntegrationSource[]; busy: boolean; onCreate: (title: string, sourceIds: string[]) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const eligible = sources.filter(source => source.eligible);
  return <form className="qd-integration-create" onSubmit={event => { event.preventDefault(); void onCreate(title.trim(), ids); }}><label>完整成果的标题<input value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：泰国五日出行攻略" maxLength={300} required /></label><fieldset><legend>选择已验收的成果 <span>{ids.length} / {eligible.length}</span></legend><div className="qd-integration-create-sources">{eligible.map(source => <label key={source.artifactId}><input type="checkbox" checked={ids.includes(source.artifactId)} onChange={e => setIds(e.target.checked ? [...ids, source.artifactId] : ids.filter(id => id !== source.artifactId))} /><span><strong>{source.title}</strong><small>{source.taskTitle}</small></span></label>)}</div>{!eligible.length && <p className="qd-integration-muted">先为任务提交成果并确认完成，再来整合。</p>}</fieldset><footer><span>原成果保持不变</span><button type="submit" className="qd-btn primary small" disabled={busy || !title.trim() || !ids.length}>{busy ? '创建中…' : '开始编排'}<Icon name="arrow-right" size={14} /></button></footer></form>;
}
