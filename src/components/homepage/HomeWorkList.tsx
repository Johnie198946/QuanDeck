import { useState } from 'react';
import type { Snapshot } from '../../data/types';
import { Icon } from '../ui/Icon';
import { boardStates, cardSource, type BoardCard } from './homeBoardData';

interface Props {
  cards: BoardCard[];
  projects: Snapshot[];
  showEmpty: boolean;
  openCard: (card: BoardCard) => void;
  createProject?: () => void;
  openProject: (projectId: string) => void;
  openStep: (projectId: string, taskId: string, itemId: string) => void;
}

function dateLabel(value?: string) {
  if (!value) return '未定';
  if (value.length === 10) return value.slice(5).replace('-','/');
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '未定';
}

export function HomeWorkList({cards,projects,showEmpty,openCard,openProject,openStep,createProject}:Props) {
  const [closed,setClosed] = useState<string[]>([]);
  const byProject = new Map<string,BoardCard[]>();
  for (const card of cards) {
    const id = card.projectId ?? '';
    if (!byProject.has(id)) byProject.set(id,[]);
    byProject.get(id)!.push(card);
  }
  const groups = [{id:'',name:'个人日程'}, ...projects.filter(s=>!s.project.deletedAt).map(s=>s.project)]
    .filter(p=>byProject.has(p.id) || (showEmpty && p.id));
  if (!groups.length) return <div className="qhb-empty"><span>暂无任务</span>
    {createProject && <button type="button" onClick={createProject}>新建项目</button>}
  </div>;
  return <div className="qhw-list" aria-label="全部工作">
    <div className="qhw-list-head" aria-hidden="true"><span>任务</span><span>状态</span><span>负责人</span><span>截止</span></div>
    {groups.map(group => {
      const rows=byProject.get(group.id) ?? [];
      const open=!closed.includes(group.id);
      return <section key={group.id} aria-label={group.name} className="qhw-group">
        <div className="qhw-group-head">
          <button type="button" aria-expanded={open} onClick={()=>setClosed(open ? [...closed,group.id] : closed.filter(id=>id!==group.id))}>
            <Icon name={open?'chevron-down':'chevron-right'} size={14}/><Icon name={group.id?'folder':'calendar'} size={15}/>
            <strong>{group.name}</strong><small>{rows.filter(row=>row.state==='done').length}/{rows.length} 项完成</small>
          </button>
          {group.id && <button type="button" className="qd-icon-btn" aria-label={'打开项目 '+group.name} onClick={()=>openProject(group.id)}><Icon name="external" size={14}/></button>}
        </div>
        {open && rows.map(card => {
          const source=cardSource(card);
          return <div className="qhw-item" key={card.key}>
            <button className="qhw-row" type="button" aria-label={'查看任务 '+card.title} onClick={()=>openCard(card)}>
              <span className="qhw-title"><span className="qht-source" data-kind={source.kind}>{source.label}</span><strong>{card.title}</strong></span>
              <span className="qhw-state"><i className={'qhb-dot '+card.state}/>{boardStates[card.state]}</span>
              <span>{card.ownerName}</span><span>{dateLabel(card.due)}</span>
            </button>
            {card.steps.length>0 && card.projectId && card.taskId && <details className="qhw-steps">
              <summary>{card.steps.length} 项子任务</summary>
              {card.steps.map(step=><button key={step.id} type="button" onClick={()=>openStep(card.projectId!,card.taskId!,step.id)}>
                <span>{step.title}</span><small>{step.state}</small><Icon name="chevron-right" size={12}/>
              </button>)}
            </details>}
          </div>;
        })}
        {open && !rows.length && <p className="qhw-empty">暂无任务</p>}
      </section>;
    })}
  </div>;
}
