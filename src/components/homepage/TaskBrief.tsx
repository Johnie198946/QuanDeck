import { useEffect, useMemo, useState } from 'react';
import { taskBriefInput, type TaskBriefResult } from '../../data/taskBrief';
import type { Snapshot } from '../../data/types';
import type { KnowledgeNote } from '../../data/knowledgeNotes';
import { desktopHost } from '../../integration/desktop';
import { Icon } from '../ui/Icon';
import { cardTakeaway, type BoardCard } from './homeBoardData';
import './task-brief.css';

const labels = {origin:'缘由',current:'进展',next:'下一步'};
type State = {result:TaskBriefResult} | {error:string} | null;

export function TaskBrief({card,notes,snapshot}: {card:BoardCard; notes:KnowledgeNote[]; snapshot?:Snapshot}) {
  const input = useMemo(() => taskBriefInput(card,notes,snapshot), [card,notes,snapshot]);
  return <Brief key={input.revision} card={card} input={input}/>;
}

function Brief({card,input}: {card:BoardCard; input:ReturnType<typeof taskBriefInput>}) {
  const [state,setState] = useState<State>(null), [attempt,setAttempt] = useState(0);
  const [source,setSource] = useState('');
  const agent = desktopHost()?.distillTaskBrief;
  useEffect(() => {
    if (!agent) return;
    let active = true;
    Promise.resolve().then(() => active ? agent(card.key,card.projectId,input.revision) : undefined)
      .then(result => { if (active && result) setState({result}); })
      .catch(cause => {
        const message = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '';
        if (active) setState({error:message || '暂时无法生成。'});
      });
    return () => { active = false; };
  }, [card.key,card.projectId,input.revision,agent,attempt]);
  const result = state && 'result' in state && state.result;
  const error = state && 'error' in state && state.error;
  const cited = result && result.points.find(point => point.section === source);
  const fact = cited && input.rows.find(row => row.id === cited.source);
  const recent = cardTakeaway(card);
  return <section className="qtask-brief" aria-label="任务简报">
    <div className="qtask-brief-heading"><h3>任务简报</h3>
      {result && <small>{({codex:'Codex',claude:'Claude',dsh:'DSH'})[result.provider] || result.provider}</small>}
    </div>
    {result ? <dl>{result.points.map(point => <div key={point.section} data-section={point.section}>
      <dt>{labels[point.section]}</dt><dd>{point.text} <button type="button" className="qtask-cite" title="查看原文" aria-label={'查看'+labels[point.section]+'依据'}
        aria-expanded={source===point.section} onClick={()=>setSource(source===point.section?'':point.section)}><Icon name="link" size={13}/></button></dd>
    </div>)}</dl> : <>
      <p className="qtask-preview"><small>{recent?.label || '来源记录'}</small>{recent?.text || card.sources[0]?.text || card.title}</p>
      <p className="qtask-agent-status" role="status">{error || (agent ? 'Agent 正在整理任务记录…' : '连接桌面 Agent 后可生成简报。')}
        {error && <button type="button" onClick={()=>{setState(null);setAttempt(n=>n+1);}}>重试</button>}</p>
    </>}
    {fact && cited && <aside className="qtask-evidence"><small>{fact.label}{fact.at && ' · '+fact.at}</small><p>{cited.quote}</p></aside>}
  </section>;
}
