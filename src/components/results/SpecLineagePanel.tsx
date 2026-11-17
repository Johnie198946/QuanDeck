import { useEffect, useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { currentProjectSpec, deriveSpecLineage, projectSpecBundle } from '../../data/specLineage';
import { inspectIntegration, inspectIntegrationVersion, listIntegrationSources, type IntegrationChoice, type IntegrationCommand, type IntegrationSection } from '../../data/resultIntegration';
import { desktopHost } from '../../integration/desktop';
import { listSpecAttachmentCandidates, specAttachmentPin, type SpecAttachmentCandidate, type SpecAttachmentImport } from '../../data/specAttachments';
import { ResultMarkdown } from './ResultDocument';
import './spec-lineage.css';

/** This edits existing integration revisions; it never stores a parallel spec document. */
export function SpecLineagePanel({ taskKey, artifactId }: { taskKey?: string; artifactId?: string }) {
  const { snap, api, toast, openProjectDirection } = useWorkdeck();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [reviewed, setReviewed] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]), [body, setBody] = useState<IntegrationSection[]>([]);
  const [message, setMessage] = useState('');
  const [imported, setImported] = useState<SpecAttachmentImport>();
  const [choices, setChoices] = useState<Record<string, IntegrationChoice>>({});
  const [excludeReasons, setExcludeReasons] = useState<Record<string, string>>({});
  const bundle = projectSpecBundle(snap), published = currentProjectSpec(snap);
  const draft = Object.values(snap.integration?.drafts ?? {}).filter(d => d.bundleId === bundle?.id && d.status === 'draft').at(-1);
  const revision = snap.integration?.revisions.find(r => r.id === draft?.revisionId);
  const inspection = draft ? inspectIntegration(snap, draft.id) : undefined;
  const publishedIssues = published ? inspectIntegrationVersion(snap, published.id)?.issues.filter(issue => issue.severity === 'blocking') ?? [] : [];
  const sources = listIntegrationSources(snap), available = sources.filter(s => s.eligible);
  const pins = revision?.sourcePins ?? published?.sourcePins ?? [];
  const options = sources.filter(s => s.eligible || pins.some(p => p.artifactId === s.artifactId));
  const removed = pins.filter(pin => !chosen.includes(pin.artifactId));
  const sourceSelectionValid = !!chosen.length && chosen.every(id => available.some(s => s.artifactId === id)) && removed.every(pin => excludeReasons[pin.artifactId]?.trim());
  const lineage = taskKey ? deriveSpecLineage(snap, taskKey) : undefined;
  const selected = sources.find(s => s.artifactId === artifactId);
  useEffect(() => {
    setBody(structuredClone(revision?.sections ?? []));
    setChosen((revision?.sourcePins ?? published?.sourcePins ?? []).map(pin => pin.artifactId));
    setExcludeReasons({}); setReviewed(false); setChoices({}); setImported(undefined);
  }, [revision?.id, published?.id]);
  const perform = async (command: Omit<IntegrationCommand, 'projectId' | 'idempotencyKey'>) => {
    setBusy(true); setMessage('');
    try {
      const result = await api.integrate({ ...command, projectId: snap.project.id, idempotencyKey: crypto.randomUUID() });
      setMessage(result.ok && command.type === 'publish' ? '项目规范已发布，后续任务沿用此版本。' : result.message ?? (result.ok ? '已保存' : '操作失败'));
      if (!result.ok) toast(result.message ?? '操作失败', 'error');
      else setReviewed(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const sectionsForSources = (sections: IntegrationSection[], ids: string[]) => {
    const retained = sections.map(section => ({ ...section, sourceIds: section.sourceIds.filter(id => ids.includes(id)) })).filter(section => section.sourceIds.length);
    const additions = sources.filter(source => ids.includes(source.artifactId) && !retained.some(section => section.sourceIds.includes(source.artifactId)));
    return [...retained, ...additions.map(source => ({ id: crypto.randomUUID(), title: source.title, body: source.body, sourceIds: [source.artifactId] }))];
  };
  const chooseSource = (id: string, checked: boolean) => {
    const ids = checked ? [...new Set([...chosen, id])] : chosen.filter(value => value !== id);
    setChosen(ids); setReviewed(false);
    if (draft) setBody(sectionsForSources(body, ids));
  };
  const create = () => perform({ type: 'create', payload: {
    purpose: 'project_spec', bundleId: bundle?.id, title: published?.title ?? `${snap.project.name} · 项目规范`,
    sourceIds: chosen, sections: sectionsForSources(published?.sections ?? [], chosen), excludeReasons,
  } });
  const importAttachment = async (candidate: SpecAttachmentCandidate) => {
    setBusy(true); setMessage(''); setImported(undefined); setReviewed(false);
    try {
      const host = desktopHost();
      if (!host?.importSpecAttachment) throw new Error('请在 QuanDeck 桌面客户端读取本地规范附件');
      const value = await host.importSpecAttachment(snap.project.id, candidate.artifactId, candidate.id);
      setImported(value); setMessage('正文已固定，请核对后加入草案；当前项目规范尚未改变。');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const includeImported = () => {
    if (!imported || !chosen.includes(imported.artifactId)) return;
    setBody([...body, { id: crypto.randomUUID(), title: imported.name, body: imported.body,
      sourceIds: [imported.artifactId], attachmentSources: [specAttachmentPin(imported)] }]);
    setImported(undefined); setReviewed(false); setMessage('附件正文已加入草案，保存后核对并发布才会供后续任务沿用。');
  };
  const dirty = JSON.stringify(body) !== JSON.stringify(revision?.sections ?? []) || JSON.stringify(chosen) !== JSON.stringify(revision?.sourcePins.map(pin => pin.artifactId) ?? []);
  return <section className="qd-spec-lineage" aria-label="项目规范与任务来源">
    <header><div><strong>项目规范 {published ? `v${published.version}` : '尚未发布'}</strong><p>{published ? '任务沿用已确认版本；修订保留来源和历史。' : '已确认方向决定执行范围；任务候选和附件尚未成为统一规范。'}</p></div><button type="button" className="qd-btn ghost small" aria-expanded={open} onClick={() => { setOpen(!open); if (!draft && selected?.eligible) setChosen([...new Set([...pins.map(pin => pin.artifactId), selected.artifactId])]); }}>{open ? '收起规范' : published ? '查看规范与修订' : '建立项目规范'}</button></header>
    {lineage && <div className="qd-spec-chain"><span>方向 {lineage.directions.length ? lineage.directions.map(d => `${d.title} v${d.version}`).join(' / ') : '未关联'}</span><span aria-hidden="true">→</span><span>任务要求 v{lineage.taskSpecRevision ?? '—'}</span><span aria-hidden="true">→</span><span>{lineage.pinnedProjectSpec ? `本次固定规范 v${lineage.pinnedProjectSpec.version}` : '本次未固定项目规范'}</span>{lineage.stale && <strong role="status">规范已更新，需重新核对</strong>}</div>}
    {selected && <p className="qd-spec-source-state">此章来源：{selected.taskTitle} · {selected.eligible ? '已验收，可纳入规范草案' : '候选成果，尚未成为项目规范'}{!selected.eligible && <small>（{selected.reasons.join('；')}）</small>}</p>}
    {!!publishedIssues.length && <p role="status">规范来源有待核对。当前仍固定 v{published!.version} 正文；来源的后续改动不会自动改写项目规范。</p>}
    {open && <div className="qd-spec-editor">
      <button className="qd-link" type="button" onClick={() => void openProjectDirection(snap.project.id)}>查看项目方向</button>
      {published && <details><summary>当前生效正文 · v{published.version}</summary>{published.sections.map(section => <section key={section.id}><h3>{section.title}</h3><ResultMarkdown text={section.body} /><AttachmentOrigins pins={section.attachmentSources} /></section>)}<p>来源：{published.sourcePins.map(pin => `${pin.taskTitle} / ${pin.title}`).join('；')}</p>{publishedIssues.map(issue => <p key={issue.id}>{issue.message}</p>)}</details>}
      <h3>{draft ? `规范草案 · 第 ${draft.revision} 次保存` : published ? '从当前版本修订' : '选择规范来源'}</h3>
      <p>仅纳入已经验收的任务成果。创建草案后可读取 .md / .txt 附件，核对完整正文再纳入规范；单独一个链接不会成为规范。</p>
      {!available.length && <p role="status">还没有已验收来源。候选仍在成果地图中保留，请先核对对应成果。</p>}
      <fieldset><legend>加入规范的任务成果</legend>{options.map(source => <label key={source.artifactId}><input type="checkbox" checked={chosen.includes(source.artifactId)} disabled={!source.eligible && !chosen.includes(source.artifactId)} onChange={event => chooseSource(source.artifactId, event.target.checked)} />{source.title}<small>{source.taskTitle}{!source.eligible && ` · ${source.reasons.join('；')}`}</small></label>)}</fieldset>
      {removed.map(pin => <label className="qd-spec-section" key={pin.artifactId}><span>移除「{pin.title}」的理由</span><input type="text" value={excludeReasons[pin.artifactId] ?? ''} onChange={event => setExcludeReasons({ ...excludeReasons, [pin.artifactId]: event.target.value })} placeholder="例如：由本次已验收的新版本替代" /></label>)}
      {!draft ? <button type="button" className="qd-btn primary small" disabled={busy || !sourceSelectionValid} onClick={() => void create()}>创建规范修订草案</button> : <>
        <p>确认正文及来源后发布。此操作只确定项目规范，不会代替其他任务的验收。</p>
        {chosen.flatMap(id => listSpecAttachmentCandidates(snap, id)).length > 0 && <div className="qd-spec-imports">
          <h4>从成果附件读取正文</h4><p>只读取来源任务项目内的 .md / .txt，最多 300 KB、100000 字符；不访问网络。</p>
          {chosen.flatMap(id => listSpecAttachmentCandidates(snap, id)).map(candidate => <div className="qd-spec-import-row" key={candidate.id}><div><strong>{candidate.name}</strong><small>{sources.find(source => source.artifactId === candidate.artifactId)?.title}</small></div><button type="button" className="qd-btn ghost small" disabled={busy || !desktopHost()?.importSpecAttachment} onClick={() => void importAttachment(candidate)}>读取附件正文</button></div>)}
          {!desktopHost()?.importSpecAttachment && <p>本地文件读取需要 QuanDeck 桌面客户端。</p>}
        </div>}
        {imported && chosen.includes(imported.artifactId) && <section className="qd-spec-import-preview" aria-label="待核对的附件正文">
          <h4>{imported.name} · 待核对</h4><AttachmentOrigins pins={[specAttachmentPin(imported)]} />
          <textarea aria-label="读取到的完整附件正文" readOnly value={imported.body} />
          <p>这是导入时的完整正文。加入草案后可以编辑；原文件及导入记录保持不变。</p>
          <button className="qd-btn primary small" type="button" disabled={busy || body.some(section => section.attachmentSources?.some(pin => pin.importId === imported.importId))} onClick={includeImported}>加入规范草案</button>
          <button className="qd-btn ghost small" type="button" onClick={() => setImported(undefined)}>暂不加入</button>
        </section>}
        {body.map((section, index) => <label className="qd-spec-section" key={section.id}><span>{section.title}</span><textarea aria-label={`${section.title}规范正文`} value={section.body} onChange={event => { setReviewed(false); setBody(body.map((value, n) => n === index ? { ...value, body: event.target.value } : value)); }} /><small>来源：{section.sourceIds.map(id => sources.find(source => source.artifactId === id)?.title ?? id).join('；')}</small><AttachmentOrigins pins={section.attachmentSources} /></label>)}
        <button type="button" className="qd-btn ghost small" disabled={busy || !dirty || !sourceSelectionValid} onClick={() => void perform({ type: 'save', draftId: draft.id, expectedRevision: draft.revision, payload: { title: revision!.title, sourceIds: chosen, sections: body, excludeReasons } })}>保存正文</button>
        {!!inspection?.issues.length && <ul>{inspection.issues.map(issue => <li key={issue.id}>{issue.message}</li>)}</ul>}
        {draft.baseVersionId !== bundle?.publishedVersionId && <div className="qd-spec-conflicts">
          {inspection?.mergeConflicts.map(conflict => <fieldset key={conflict.key}><legend>{conflict.label}</legend><details><summary>比较修订与当前版本</summary><strong>本次草案</strong><pre>{typeof conflict.ours === 'string' ? conflict.ours : JSON.stringify(conflict.ours, null, 2)}</pre><strong>当前项目规范</strong><pre>{typeof conflict.theirs === 'string' ? conflict.theirs : JSON.stringify(conflict.theirs, null, 2)}</pre></details><label><input type="radio" name={`spec-${conflict.key}`} checked={choices[conflict.key] === 'ours'} onChange={() => setChoices({ ...choices, [conflict.key]: 'ours' })} />采用本次草案</label><label><input type="radio" name={`spec-${conflict.key}`} checked={choices[conflict.key] === 'theirs'} onChange={() => setChoices({ ...choices, [conflict.key]: 'theirs' })} />采用当前规范</label></fieldset>)}
          <button type="button" className="qd-btn ghost small" disabled={busy || dirty || inspection?.mergeConflicts.some(conflict => !choices[conflict.key])} onClick={() => void perform({ type: 'rebase', draftId: draft.id, expectedRevision: draft.revision, payload: { expectedBundleVersion: bundle!.version, choices } })}>合并最新规范版本</button>
        </div>}
        <label className="qd-spec-confirm"><input type="checkbox" disabled={dirty || busy} checked={reviewed} onChange={event => setReviewed(event.target.checked)} />我已核对正文、来源及对后续任务的影响</label>
        <button type="button" className="qd-btn primary small" disabled={busy || dirty || !reviewed || !inspection?.canPublish} onClick={() => void perform({ type: 'publish', draftId: draft.id, expectedRevision: draft.revision, payload: { reviewed: true, expectedBundleVersion: bundle!.version, reviewNote: '用户在成果地图确认项目规范正文、来源与后续影响' } })}>发布项目规范 v{(bundle?.version ?? 0) + 1}</button>
      </>}
      {message && <p role="status">{message}</p>}
    </div>}
  </section>;
}

function AttachmentOrigins({ pins }: { pins?: import('../../data/specAttachments').SpecAttachmentPin[] }) {
  if (!pins?.length) return null;
  return <details className="qd-spec-file-origin"><summary>已固定 {pins.length} 份附件来源</summary>{pins.map(pin => <div key={pin.importId}><strong>{pin.name}</strong><p>{pin.path ?? `附件 ${pin.attachmentId}`} · {pin.size} 字节</p><small>原文件 SHA-256：{pin.fileHash}<br />来源成果：{pin.artifactId}<br />正文可在草案中编辑，文件指纹表示导入时的原件。</small></div>)}</details>;
}
