import { annotationHistory, type AnnotationHistoryEntry } from './annotationHistory';
import { hashText } from './contentHash';
import type { Snapshot } from './types';

export const judgmentLabels = { unresolved:'待核对', conflict:'确有冲突', separate:'适用条件不同', unrelated:'没有冲突' } as const;
export type Judgment = keyof typeof judgmentLabels;
export interface AnnotationJudgment {
  id:string; projectId:string; pairId:string; revision:number; verdict:Judgment; note:string; author:string; at:string;
}
export interface EvolutionPair {
  id:string; earlier:AnnotationHistoryEntry; later:AnnotationHistoryEntry; topic:string; revision:boolean;
}
type Signal = {key:string; direction:string; topic:string};
const lexicon = [
  ['布局', /侧边栏?|侧栏|右栏|右侧|顶部|顶栏/g, /顶部|顶栏/, /侧边栏?|侧栏|右栏|右侧/],
  ['展开方式', /默认(?:收起|折叠|展开)/g, /收起|折叠/, /展开/],
  ['确认方式', /自动(?:确认|通过|批准)|手动(?:确认|通过|批准)|人工(?:确认|审核|批准)|逐次(?:确认|审批)/g, /自动/, /手动|人工|逐次/],
] as const;
// A candidate needs one unambiguous pair of opposing choices on a shared subject.
// Never compare unrelated work, infer a change from mere chronology, or relabel a revision as a dispute.
function signals(entry:AnnotationHistoryEntry):Signal[] {
  if(entry.state!=='current')return [];
  if(entry.kind==='discussion'){
    if(entry.action==='偏好这项'||entry.action==='不选这项')return [{key:'option',direction:entry.action,topic:'同一讨论选项'}];
    return [];
  }
  if(entry.kind==='review'){
    if(entry.action==='确认成果'||entry.action==='要求修改')return [{key:'review',direction:entry.action,topic:'同一提交的核对意见'}];
    return [];
  }
  const result:Signal[]=[];
  const directives=[...entry.text.matchAll(/(允许|可以|禁止|不允许|不得)(导出|删除|分享|下载|发布)([^，。；;\s!?！？]{1,20})(?=[，。；;\s!?！？]|$)/g)];
  if(directives.length===1){
    const [,modal,verb,object]=directives[0];
    result.push({key:'permission:'+verb+object,direction:modal==='允许'||modal==='可以'?'permit':'deny',topic:verb+object+' · 权限'});
  }
  for(const [axis,pattern,left,right] of lexicon){
    const matches=entry.text.match(pattern)??[];
    // Don't misinterpret negation, comparisons, or a sentence describing both positions.
    if(!matches.length||/不要|不应|不再|禁止|不能|取消|不放|不想|不在|无需|不需要|避免/.test(entry.text))continue;
    const a=matches.some(m=>left.test(m)), b=matches.some(m=>right.test(m));
    if(a===b)continue;
    const subject=entry.text.match(/(?:批注历史|讨论区|讨论栏|讨论|授权|审批|进度条|任务详情|历史记录|历史|成果|附件|面板|工具栏|导航|卡片)/)?.[0];
    if(subject)result.push({key:axis+':'+subject,direction:a?'a':'b',topic:subject+' · '+axis});
  }
  return result;
}
export function compareConditions(entry:AnnotationHistoryEntry):string {
  const words=entry.text.match(/(?:宽屏|窄屏|桌面端|移动端|手机端|小屏|大屏|待验收|已验收|执行中|未开始|已完成|运行中|暂停时|离线时)|(?:当|如果|仅在|只有)[^。；;，,\n]{1,32}/g);
  return words?.length?[...new Set(words)].join('、'):'原文未标明适用条件';
}
export function annotationEvolution(entries:AnnotationHistoryEntry[]){
  const ordered=[...entries].sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
  const byId=new Map(entries.map(e=>[e.id,e]));
  const prior=new Map<string,Map<string,AnnotationHistoryEntry>>(), revisions:EvolutionPair[]=[], comparisons:EvolutionPair[]=[];
  const make=(a:AnnotationHistoryEntry,b:AnnotationHistoryEntry,topic:string,revision:boolean):EvolutionPair=>({
    id:hashText(JSON.stringify([topic,a.id,a.comparisonScope,a.version,a.text,a.action,b.id,b.comparisonScope,b.version,b.text,b.action])),earlier:a,later:b,topic,revision,
  });
  for(const entry of ordered){
    const prev=entry.previousId&&byId.get(entry.previousId);
    if(prev&&prev.nextId===entry.id)revisions.push(make(prev,entry,entry.state==='withdrawn'?'撤回':'修改',true));
    for(const s of signals(entry)){
      const key=JSON.stringify([entry.comparisonScope,s.key]), bucket=prior.get(key)??new Map<string,AnnotationHistoryEntry>();
      for(const [direction,other] of bucket)if(direction!==s.direction)comparisons.push(make(other,entry,s.topic,false));
      bucket.set(s.direction,entry); prior.set(key,bucket);
    }
  }
  return {ordered,revisions:revisions.reverse(),comparisons:comparisons.reverse()};
}
export function recordAnnotationJudgment(s:Snapshot,p:Record<string,unknown>,actor:string):AnnotationJudgment{
  const fail=(code:string,message:string):never=>{throw Object.assign(Error(message),{code})};
  if(typeof p.pairId!=='string'||!annotationEvolution(annotationHistory(s)).comparisons.some(x=>x.id===p.pairId))fail('SOURCE_CHANGED','对照来源已变化，请重新打开原文');
  if(typeof p.verdict!=='string'||!Object.prototype.hasOwnProperty.call(judgmentLabels,p.verdict)||typeof p.note!=='string'||p.note.trim().length>600)fail('INVALID_JUDGMENT','请选择判断，说明限 600 字');
  const prior=(s.collaboration!.annotationJudgments??[]).filter(x=>x.projectId===s.project.id&&x.pairId===p.pairId).at(-1);
  if(p.expectedRevision!==(prior?.revision??0))fail('VERSION_CONFLICT','该判断已更新，请刷新后重试');
  const record={id:'annotation-judgment:'+crypto.randomUUID(),projectId:s.project.id,pairId:p.pairId as string,revision:(prior?.revision??0)+1,verdict:p.verdict as Judgment,note:(p.note as string).trim(),author:actor,at:new Date().toISOString()};
  (s.collaboration!.annotationJudgments??=[]).push(record);
  return record;
}
