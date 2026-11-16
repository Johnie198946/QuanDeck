import { useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { IntegrationReader } from './IntegrationReader';
import { integrationMarkdown } from '../../data/resultIntegration';
import './integration.css';

/** Historical authored documents remain readable; current assembly belongs to the delivery map. */
export function ResultsIntegration() {
  const { snap } = useWorkdeck();
  const [selected, setSelected] = useState('');
  const versions = [...(snap.integration?.versions ?? [])].sort((a, b) => b.at.localeCompare(a.at));
  const drafts = Object.values(snap.integration?.drafts ?? {}).filter(item => item.status === 'draft').flatMap(draft => {
    const revision = snap.integration?.revisions.find(item => item.id === draft.revisionId);
    return revision ? [revision] : [];
  });
  const choices = [...versions.map(content => ({ content, version: content.version, label: `${content.title} · v${content.version}` })), ...drafts.map(content => ({ content, version: undefined, label: `${content.title} · 历史草稿` }))];
  const active = choices.find(item => item.content.id === selected) ?? choices[0];
  const download = () => {
    if (!active) return;
    const body = active.version ? integrationMarkdown(snap, active.content.id) : [`# ${active.content.title}`, ...active.content.sections.map(section => `## ${section.title}\n\n${section.body}`)].join('\n\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${active.content.title.replace(/[\\/:*?"<>|]/g, '_')}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="qd-integration" aria-label="历史完整成果"><header className="qd-map-history-header"><div><h2>完整成果 · 历史</h2><p>保留原来的编排与来源，当前任务的交付会自动汇入成果地图。</p></div>{choices.length > 1 && <select aria-label="选择历史完整成果" value={active?.content.id} onChange={event => setSelected(event.target.value)}>{choices.map(item => <option key={item.content.id} value={item.content.id}>{item.label}</option>)}</select>}{active && <button type="button" className="qd-link" onClick={download}>导出全文</button>}</header>{active ? <IntegrationReader key={active.content.id} content={active.content} version={active.version} at={active.content.at} /> : <p className="qd-integration-muted">还没有保存的完整成果。</p>}</section>;
}
