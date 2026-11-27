import { useMemo, useState } from 'react';
import { briefInsightInput, type ProjectBriefInsight, type ProjectBriefSource } from '../../data/projectBriefInsight';
import { desktopHost } from '../../integration/desktop';
import { Icon } from '../ui/Icon';
import './project-brief-insights.css';

interface Props {
  projectId: string;
  sources: readonly ProjectBriefSource[];
  onOpenSource: (id: string) => void;
}

export function ProjectBriefInsights({ projectId, sources, onOpenSource }: Props) {
  const input = useMemo(() => briefInsightInput(projectId, sources), [projectId, sources]);
  if (!input.rows.length || !desktopHost()?.distillProjectBrief) return null;
  return <BriefDisclosure key={input.evidenceKey} projectId={projectId} input={input} onOpenSource={onOpenSource}/>;
}

function BriefDisclosure({ projectId, input, onOpenSource }: Pick<Props, 'projectId' | 'onOpenSource'> & {
  input: ReturnType<typeof briefInsightInput>;
}) {
  const [opened, setOpened] = useState(false);
  const [result, setResult] = useState<ProjectBriefInsight>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setBusy(true);
    setError('');
    try {
      const host = desktopHost();
      if (!host?.distillProjectBrief) throw new Error('请在桌面版连接 Agent 后重试。');
      setResult(await host.distillProjectBrief(projectId, input.evidenceKey));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '';
      setError(message || '暂时无法提炼，请重试。');
    } finally { setBusy(false); }
  }
  function toggle() {
    setOpened(!opened);
    if (!opened && !busy && !result && !error) void load();
  }
  return <section className="qh-brief-insights" aria-label="AI 提炼">
    <button type="button" className="qh-brief-insight-toggle" aria-expanded={opened} onClick={toggle}>
      <Icon name="bulb" size={15}/>从资料里看变化<Icon name={opened ? 'chevron-down' : 'chevron-right'} size={13}/>
    </button>
    {opened && <div className="qh-brief-insight-body" aria-live="polite">
      {busy && <span role="status">Agent 正在提炼，可继续查看项目。</span>}
      {error && <div>{error} <button type="button" disabled={busy} onClick={() => void load()}>重试</button></div>}
      {result && <>
        <small>{({ codex: 'Codex', claude: 'Claude', dsh: 'DSH' })[result.provider] ?? result.provider} · {result.sourceCount === result.availableCount
          ? '参考了 ' + result.sourceCount + ' 条资料' : '从 ' + result.availableCount + ' 条中选取了 ' + result.sourceCount + ' 条'}</small>
        {result.points.length ? <ul>{result.points.map((point, index) => <li key={index}>
          <p>{point.text}</p>
          {point.citations.map(ref => <button type="button" className="qh-brief-citation" key={ref.sourceId}
            title={'打开来源：' + (input.rows.find(row => row.id === ref.sourceId)?.title ?? ref.quote)}
            onClick={() => onOpenSource(ref.sourceId)}><Icon name="link" size={12}/>{ref.quote}</button>)}
        </li>)}</ul> : <p>这些资料暂时看不出明确变化。</p>}
      </>}
    </div>}
  </section>;
}
