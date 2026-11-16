import type { IntegrationContent } from '../../data/resultIntegration';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';

/** Reader view consumes a pinned document; it never rebuilds its prose from current tasks. */
export function IntegrationReader({ content, version, at }: { content: IntegrationContent; version?: number; at?: string }) {
  const { snap, openSourceSession, openWorkspace, toast } = useWorkdeck();
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); toast('已复制'); } catch { toast('复制失败，请选中文字复制', 'error'); } };
  const sectionId = (id: string) => `integration-section-${id}`;
  const scrollTo = (id: string) => { const node = document.getElementById(id); const details = node?.closest('details'); if (details) details.open = true; node?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); };
  const used = new Set(content.sections.flatMap(section => section.sourceIds));
  return <article className="qd-integration-document">
    <header className="qd-integration-document-head"><span>{version ? `已发布 · v${version}` : '草稿预览'}</span><h2>{content.title}</h2><p>{content.sections.length} 个章节 <span>·</span> {used.size} / {content.sourcePins.length} 份来源已采用{at && <> <span>·</span> {new Date(at).toLocaleDateString('zh-CN')}</>}</p></header>
    {content.sections.length > 0 && <nav className="qd-integration-route" aria-label="成果章节路线">{content.sections.map((section, index) => <button type="button" key={section.id} onClick={() => scrollTo(sectionId(section.id))}><b>{String(index + 1).padStart(2, '0')}</b><span>{section.title}</span><small>{section.schedule?.date ?? '未安排日期'}</small></button>)}</nav>}
    <div className="qd-integration-timeline">{content.sections.map((section, index) => <section key={section.id} id={sectionId(section.id)} className="qd-integration-chapter">
      <div className="qd-integration-chapter-date"><b>{String(index + 1).padStart(2, '0')}</b><span>{section.schedule?.date ?? '章节'}</span>{section.schedule?.start && <small>{section.schedule.start}–{section.schedule.end}</small>}</div>
      <div><h3>{section.title}</h3>{section.schedule?.resource && <p className="qd-integration-muted">{section.schedule.resource}</p>}<div className="qd-integration-prose">{section.body.split(/\n{2,}/).map((paragraph, i) => <p key={i}>{paragraph}</p>)}</div>
        {!!section.facts?.length && <dl className="qd-integration-facts">{section.facts.map((fact, i) => <div key={i}><dt>{fact.key}</dt><dd>{fact.value}</dd></div>)}</dl>}
        <div className="qd-integration-citations">{section.sourceIds.map(id => { const source = content.sourcePins.find(pin => pin.artifactId === id); return <a key={id} href={`#integration-source-${id}`} onClick={event => { event.preventDefault(); scrollTo(`integration-source-${id}`); }}><Icon name="link" size={12} />{source?.title ?? '来源待核对'}</a>; })}{!section.sourceIds.length && <span>人工编排</span>}</div>
      </div>
    </section>)}</div>
    <details className="qd-integration-provenance"><summary>来源与任务链路 · {content.sourcePins.length}</summary>
      <div className="qd-integration-source-matrix" aria-label="来源与章节对应关系">{content.sourcePins.map((source, index) => <div key={source.artifactId}><span>{index + 1}. {source.title}</span><div>{content.sections.map((section, n) => <a key={section.id} href={`#${sectionId(section.id)}`} className={section.sourceIds.includes(source.artifactId) ? 'is-used' : ''} aria-label={`${source.title}，${section.title}：${section.sourceIds.includes(source.artifactId) ? '已采用' : '未采用'}`}>{n + 1}</a>)}</div></div>)}</div>
      {content.sourcePins.map(source => <section key={source.artifactId} id={`integration-source-${source.artifactId}`}><h3>{source.title}</h3><p>{source.taskTitle} · {source.tool ?? '人工'}</p><dl>{([['任务 ID', source.taskKey], ['成果 ID', source.artifactId], ['执行 ID', source.runId], ['本地会话 ID', source.sessionId], ['Agent Session ID', source.sourceSessionId], ['连接 ID', source.connectionId]] as [string, string | undefined][]).filter((pair): pair is [string,string] => !!pair[1]).map(([label, value]) => <div key={label}><dt>{label}</dt><dd><code>{value}</code><button type="button" onClick={() => void copy(value)} aria-label={`复制${label}`}>复制</button></dd></div>)}</dl><div className="qd-integration-actions"><button type="button" className="qd-link" disabled={!snap.tasks[source.taskId]} onClick={() => openWorkspace(source.taskId, { view: 'results', focus: true })}>查看任务</button>{source.sessionId && <button type="button" className="qd-link" onClick={() => openSourceSession(source.sessionId!)}>打开来源会话<Icon name="external" size={12} /></button>}</div></section>)}
    </details>
  </article>;
}
