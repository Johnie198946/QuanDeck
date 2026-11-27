import { methodBoards } from './methodBoards';
import { noteTaskLabel } from './noteTaskLabel';
import { scheduleOutcomeGroups } from './scheduleOutcomeGroups';
import { outcomeShelf } from '../components/homepage/outcomeShelf';
import { scheduleEntries } from './agendaSchedule';
import { occurrences } from './scheduleOccurrence';
import { buildKnowledgeIndex, buildNoteGraph, searchKnowledge } from './knowledgeIndex';
import { makeSelection, type KnowledgeLibrary, type KnowledgeNote, type NoteSelection } from './knowledgeNotes';
import { todoLineText } from './noteTodos';
import { selectProductAttention, productReminderHidden, readProductReminderActions } from './productAttention';
import { dateInZone, timeInZone } from './timeline';
import { projectRegister, type ProjectRegisterNode } from '../components/projects/projectRegister';
import { monitorActivity } from './monitorActivity';
import type { Snapshot } from './types';

export const areas = { notes:'帮你记', ideas:'帮你想', projects:'帮你管', monitor:'帮你盯', home:'首页', search:'帮你找' } as const;
export type WorkspaceArea = keyof typeof areas;
export type WorkspaceTarget =
  | {page:'notes'; id:string; selection?:NoteSelection; todoId?:string}
  | {page:'projects'; id:string; taskId?:string; itemId?:string}
  | {page:'ideas'; id:string; evidenceKey?:string; canvas?:'note'|'link'; boardId?:string; templateId?:string}
  | {page:'monitor'; id:string}
  | {page:'search'; query:string}
  | {page:'home'; key:string; at:number};
export interface WorkspaceRow { sourceNoteIds?:string[]; group:string; label:string; detail?:string; target: WorkspaceTarget }
export interface WorkspaceAnswer {
  area: WorkspaceArea; summary: string; rule?:string; total:number; rows: WorkspaceRow[];
}
interface EvidenceRead {
  area:WorkspaceArea; summary:string; total:number; rule?:string; noteIds:string[];
  records: {source:string; title:string; excerpt:string}[];
}
export interface WorkspaceEvidence {reads:EvidenceRead[];noteIds:string[];canLookup:boolean}
export interface WorkspaceSource { library:KnowledgeLibrary; projects:Snapshot[]; noteId:string; selection:NoteSelection }
const compact = (text:string,max:number) => {
  const words=Array.from(text.replace(/\s+/gu,' ').trim());
  return words.length>max ? words.slice(0,max-1).join('')+'…' : words.join('');
};

const strikeIntent = /(?:未|没|还未|没有|未被|不带|不含|未加|没加|未标)[^。！？\n]{0,10}(?:删除线|划掉|划去|划线|划掉的|划销|划掉了|划掉过|划除|勾掉)|(?:删除线|划掉)[^。！？\n]{0,8}(?:未标|漏了)/u;
const nonQuery = /^(?:请|帮我|麻烦|把这段|将这段|直接|只要|只需|给我|你能|能否|请你|帮忙|一下|先|\s)*(?:翻译|译成|翻成|润色|改写|校对|解释(?:这句话|这段话)|缩写|translate|rewrite)/iu;

export function allowWorkspaceLookup(question:string,quote:string,externalReferences:boolean) {
  return !nonQuery.test(question.trim()) && (!externalReferences || !!requestedArea(question) || !!requestedArea(quote));
}

function requestedArea(question:string):WorkspaceArea|undefined {
  if (strikeIntent.test(question)) return 'notes';
  if (/帮你找|帮我找(?:一下)?(?:我|之前|以前)|全局搜索|(?:工作台|工作区).*(?:找|搜索)|我(?:之前|以前)(?:记|写|保存|收集)过/u.test(question)) return 'search';
  if (/帮你盯|(?:项目|工作台|当前|我的|哪些).{0,8}风险|告警|谁在执行|[Aa]gent.*在(?:忙|做)|等我(?:确认|处理|回复)|需要我处理/u.test(question)) return 'monitor';
  if (/首页|日程|甘特图|待办|今天.{0,9}(?:安排|要做|要忙|做什么)|成果库/u.test(question)) return 'home';
  if (/帮你想|画布|方法模[板版]|工作流模[板版]|灵感逻辑|知识图谱|我的灵感/u.test(question)) return 'ideas';
  if (/帮你记|我的笔记|我.{0,3}(?:写了|记了)几|笔记[里中]|多少(?:篇|条)笔记/u.test(question)) return 'notes';
  if (/帮你管|我的项目|项目进展|项目.*(?:任务|进行|进度)|任务.*(?:进度|状态)|(?:我|有|查|哪些|多少).{0,7}(?:项目|任务)/u.test(question)) return 'projects';
  if (/工作台|QuanDeck.*(?:查|记录)/iu.test(question)) return 'search';
}

function anchor(note:KnowledgeNote,start:number,length:number):WorkspaceTarget {
  return {page:'notes',id:note.id,selection:makeSelection(note.body,start,start+Math.min(length,110))};
}

function unstruck(source:WorkspaceSource,notes:KnowledgeNote[],question:string):WorkspaceAnswer {
  const rows:WorkspaceRow[]=[];
  const requestedTitles=Array.from(question.matchAll(/《([^》]+)》/gu),m=>m[1]);
  const scope=requestedTitles.length ? notes.filter(n=>requestedTitles.includes(n.title)) : /这篇|本篇|当前(?:文章|笔记)/u.test(question) ? notes.filter(n=>n.id===source.noteId) : notes;
  for(const note of scope){
    const marked=new Set((note.todos??[]).filter(t=>!t.follows).map(t=>t.lineIndex));
    let fence='';
    let index=0, offset=0;
    for(const line of note.body.split('\n')){
      const start=offset, lineIndex=index++; offset+=line.length+1;
      const marker=line.trimStart().match(/^(`{3,}|~{3,})/u)?.[1];
      if(marker){if(!fence)fence=marker;else if(marker[0]===fence[0] && marker.length>=fence.length)fence='';continue;}
      if(fence || !(marked.has(lineIndex)||/^\s*(?:(?:[-*+] |\d+[.)、．]\s*|[•●]\s*)|\[[ xX]\]\s*)/u.test(line))) continue;
      if(note.id===source.noteId && source.selection.offset>=start && source.selection.offset<offset && strikeIntent.test(source.selection.quote)) continue;
      const unmarked=line.replace(/(?<!\\)~~[\s\S]*?(?<!\\)~~/gu,'');
      const title=todoLineText(unmarked).replace(/^\s*(?:\d+[、．]\s*|[•●]\s*)/u,'').replace(/^(?:如图[，,、]|我(?:需要|希望|想要)|请(?:你|帮我))\s*/u,'').trim();
      if(!/[\p{L}\p{N}]/u.test(title)) continue;
      const excerpt = Array.from(title);
      const detail = excerpt.length > 140 ? excerpt.slice(0,62).join('')+'…'+excerpt.slice(-76).join('') : title;
      rows.push({group:note.title,label:noteTaskLabel(title),detail,target:anchor(note,start,line.length)});
    }
  }
  return {area:'notes',total:rows.length,summary:rows.length+' 条任务还没画删除线',rule:'检查了 '+scope.length+' 篇笔记中的列表项和待办行；部分划去时只显示余下内容。',rows};
}

function keyword(text:string):string {
  return (text.match(/[《「“"]([^》」”"]{1,90})[》」”"]/u)?.[1] ?? text
    .replace(/(?:请帮我|帮我|替我|请你|帮你[找记想管盯]|从|在|所有|全部|工作台|工作区|笔记[中里]?|查询|搜索|查找|找一下|有关|关于|相关的?|的资料|的内容|在哪里|有哪些|找找|之前写过的|以前写过的|以前记过的|我之前写过|我以前写过|找|[？?。！])/gu,' ').trim()).trim();
}

function searchRows(library:KnowledgeLibrary,projects:Snapshot[],text:string,notesOnly:boolean):WorkspaceRow[]{
  const index=buildKnowledgeIndex(library,notesOnly?[]:projects);
  if(!text) return [];
  return searchKnowledge(index,text,index.length).map(hit=>{
    const note=library.notes.find(n=>n.id===hit.noteId);
    const pos=note?.body.toLocaleLowerCase().indexOf(text.toLocaleLowerCase())??-1;
    return {group:note?'帮你记':(hit.projectName??'帮你找'),label:compact(hit.title,50),detail:compact(hit.excerpt,180),
      target:note ? pos>=0 ? anchor(note,pos,text.length) : {page:'notes',id:note.id} :
        hit.projectId ? {page:'projects',id:hit.projectId,taskId:hit.taskId,itemId:hit.itemId} : {page:'search',query:text}};
  });
}

export function queryWorkspace(source:WorkspaceSource,question:string,quote:string,now=Date.now(),forced?:{area:WorkspaceArea; search:string}):WorkspaceAnswer|undefined {
  if(!forced && nonQuery.test(question.trim())) return;
  const area=forced?.area ?? requestedArea(question) ?? (/[?？]|(?:查|统计|盘点|清点)/u.test(quote) ? requestedArea(quote) : undefined);
  if(!area) return;
  const text=requestedArea(question) ? question : quote+' '+question;
  const notes=source.library.notes.filter(n=>!source.library.deletedNoteIds?.includes(n.id));
  const projects=source.projects.filter(p=>p.project.id && !p.project.deletedAt);
  const library={...source.library,notes};
  let rows:WorkspaceRow[]=[], noun='';
  if(area==='notes' && strikeIntent.test(text) && !forced) return unstruck(source,notes,text);
  if(area==='notes' && !forced?.search && !/找|搜索|检索|查找|关于|有关/u.test(text)){
    noun='篇笔记';
    rows=notes.map(n=>({group:'帮你记',label:n.title,target:{page:'notes',id:n.id}}));
  }else if(area==='notes'||area==='search'){
    const term=forced?.search || keyword(text);
    rows=searchRows(library,projects,term,area==='notes');
    noun='条搜索结果';
  }else if(area==='ideas'){
    const templatesOnly = /模[板版]库|方法模[板版]|工作流模[板版]/u.test(text);
    if (templatesOnly || forced) for (const template of library.methodTemplates ?? []) {
      rows.push({group:'方法模板库',label:template.title,detail:template.summary || template.board.nodes.length+' 张卡片',
        target:{page:'ideas',id:template.id,templateId:template.id}});
    }
    if (!templatesOnly) for(const {id:boardId,title,board} of methodBoards(library)) {
      const cards=new Map(board.nodes.map(n=>[n.noteId,n.idea?.title || notes.find(note=>note.id===n.noteId)?.title || '灵感']));
      if(!/知识图谱|知识关联|连线/u.test(text)) for(const node of board.nodes) {
        const sourceNoteId=node.idea?.source?.noteId ?? node.idea?.method?.sourceNote?.id ?? (!node.idea?node.noteId:undefined);
        rows.push({sourceNoteIds:sourceNoteId?[sourceNoteId]:undefined,group:title,label:cards.get(node.noteId)!,detail:node.idea?.detail,target:{page:'ideas',id:node.noteId,canvas:'note',boardId}});
      }
      if(/连线|逻辑|关系|关联/u.test(text) && !/知识图谱/u.test(text)) for(const edge of board.links) {
        rows.push({group:title+' · 连线',label:cards.get(edge.from)+' → '+cards.get(edge.to),detail:[edge.label,edge.detail].filter(Boolean).join(' · '),target:{page:'ideas',id:edge.id,canvas:'link',boardId}});
      }
    }
    if(/图谱|知识关联|冲突|发现/u.test(text)) for(const edge of buildNoteGraph(library).edges){
      rows.push({sourceNoteIds:edge.members,group:'知识图谱',label:edge.relation.title,detail:edge.relation.agent?.explanation||edge.relation.evidence.join(' · '),target:{page:'ideas',id:edge.from,evidenceKey:edge.relation.evidenceKey}});
    }
    noun=templatesOnly?'个方法模板':'条灵感记录';
  }else if(area==='projects'){
    const named=projects.filter(p=>text.includes(p.project.name));
    const onlyProject=/项目/u.test(text)&&!/任务|子项|在做|执行/u.test(text);
    const includeChildren=/子任务|子项|各级/u.test(text);
    for(const project of named.length?named:projects){
      const root=projectRegister(project,now);
      function put(node:ProjectRegisterNode){
        if(node.bucket==='cancelled') return;
        if(!(/(?:没|未)完成/.test(text) && node.bucket==='done') && !(/已完成/.test(text) && node.bucket!=='done') &&
          !(/正在(?:做|执行)|进行中/.test(text) && node.bucket!=='running'))
          rows.push({group:root.title,label:node.title,detail:[node.state,node.owner,node.description].filter(Boolean).join(' · '),
            target:{page:'projects',id:project.project.id,taskId:node.taskId,itemId:node.itemId}});
        if(includeChildren) node.children.forEach(put);
      }
      if(onlyProject) put(root);else root.children.forEach(put);
    }
    noun=onlyProject?'个项目':includeChildren?'项任务及子任务':'项主任务';
  }else if(area==='monitor'){
    if(/在(?:做|执行|忙)|运行中|正在|排队|等待执行/u.test(text)){
      const queued=/排队|等待执行/u.test(text);
      for(const {project:p,entry:e} of monitorActivity(projects).filter(row=>row.entry.state===(queued?'queued':'running'))){
        rows.push({group:p.project.name,label:e.title,detail:[p.agents.find(a=>a.id===e.agentId)?.name,e.detail||(queued?'排队中':'正在执行')].filter(Boolean).join(' · '),target:{page:'projects',id:p.project.id,taskId:e.taskId,itemId:e.itemId}});
      }
      noun=queued?'项排队中':'项正在执行';
    }else{
      const hidden=readProductReminderActions();
      for(const e of selectProductAttention(projects,now).filter(e=>!productReminderHidden(e,hidden,now))){
        rows.push({group:e.label,label:e.title,detail:e.detail,target:{page:'monitor',id:e.id}});
      }
      noun='项需要留意';
    }
  }else{
    const entries=scheduleEntries(notes,projects);
    if(/成果库/u.test(text)){
      const shelf=outcomeShelf(scheduleOutcomeGroups(entries,notes,projects),notes,projects);
      for(const item of shelf){
        const entry=item.entry;
        rows.push({sourceNoteIds:item.trail.flatMap(t=>'noteId' in t.entry?[t.entry.noteId]:[]),group:item.projectName||entry.source,label:item.resultText||item.outcome?.files?.[0]?.name||item.delivered[0]?.title||entry.title,
          detail:[item.trail.length+' 条关联日程',item.outcome?.purpose,item.latest].filter(Boolean).join(' · '),
          target:'noteId' in entry ? {page:'notes',id:entry.noteId,todoId:entry.todoId} : {page:'projects',id:entry.projectId,taskId:entry.taskId}});
      }
      noun='项成果';
    }else{
    const zone=Intl.DateTimeFormat().resolvedOptions().timeZone, today=dateInZone(now,zone);
    const offset=/明天|明日/u.test(text)?1:/昨天|昨日/u.test(text)?-1:0;
    const day=new Date(Date.parse(today)+offset*86400000).toISOString().slice(0,10);
    const all=/所有|全部|成果库/u.test(text);
    const agenda=all ? entries.map(entry=>({entry,at:entry.at})) : occurrences(entries,day,today,zone);
    for(const {entry,at} of agenda){
      if(/未完成|没完成|还要做|今天要做/u.test(text)&&entry.done || /已完成|成果库/u.test(text)&&!entry.done) continue;
      const todo='noteId' in entry ? notes.find(n=>n.id===entry.noteId)?.todos?.find(t=>t.id===entry.todoId) : undefined;
      rows.push({sourceNoteIds:'noteId' in entry?[entry.noteId]:undefined,group:entry.source,label:entry.title,detail:[dateInZone(at,zone)+' '+timeInZone(at,zone),entry.done?'已完成':'待办',todo?.outcome?.text||entry.progress?.at(-1)?.text].filter(Boolean).join(' · '),
        target:{page:'home',key:entry.key,at}});
    }
    noun='条日程';
    }
  }
  const term=forced?.search.trim();
  if(term && area!=='search' && area!=='notes') rows=searchKnowledge(rows.map(row=>({...row,title:row.label,text:row.group+' '+(row.detail??'')})),term,rows.length);
  return {area,rows,total:rows.length,summary:rows.length+' '+noun,rule:areas[area]+' · '+(term?'匹配「'+term+'」':'提问时的记录')};
}

/** The agent sees short relevant records. Quotes, anchors and unrelated notebook bodies stay local. */
export function workspaceEvidence(results:WorkspaceAnswer[],canLookup:boolean):WorkspaceEvidence {
  const maxPerRead=Math.max(4,Math.floor(32/Math.max(1,results.length)));
  const reads=results.map(result=>{
    const first=result.rows.slice(0,maxPerRead);
    return {area:result.area,summary:result.summary,total:result.total,rule:result.rule,
      noteIds:[...new Set(first.flatMap(r=>[...(r.sourceNoteIds??[]),...(r.target.page==='notes'?[r.target.id]:[])]))],
      records:first.map(r=>({source:compact(r.group,80),title:compact(r.label,70),excerpt:compact(r.detail ?? (result.area==='notes' && r.target.page==='notes' ? r.target.selection?.quote : '') ?? '',150)}))};
  });
  return {reads,canLookup,noteIds:[...new Set(reads.flatMap(r=>r.noteIds))]};
}

export function readWorkspaceLookup(text:string):{area:WorkspaceArea;search:string}[]|undefined {
  const candidate=text.trim().replace(/^`{3}(?:json)?\s*|\s*`{3}$/g,'');
  if(!candidate.startsWith('{') || candidate.length>1600) return;
  try {
    const request=JSON.parse(candidate)?.quandeck_lookup;
    if(!request) return;
    const list=Array.isArray(request)?request:[request];
    if(!list.length || list.length>6 || list.some(q=>!q || !Object.prototype.hasOwnProperty.call(areas,q.area) || typeof q.search!=='string' || q.search.length>80)) throw Error();
    return list.map(q=>({area:q.area,search:q.search.trim()}));
  } catch { if(candidate.includes('"quandeck_lookup"')) throw Error('Agent 的工作台查询格式无效，请重试'); }
}
