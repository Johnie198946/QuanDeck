import { desktopHost } from '../integration/desktop';
import type { KnowledgeNote } from './knowledgeNotes';
import type { OutputAttachment } from './types';
import { NODE_HEIGHT, NODE_WIDTH, type InspirationBoard, type CanvasIdea } from './inspirationCanvas';

export type MethodInput =
  | { kind:'note'; id:string; fileId?:string }
  | { kind:'file'; name:string; bytes:ArrayBuffer }
  | { kind:'url'; url:string };
export interface MethodStepDetail {
  component:string; input:string; output:string; standard:string; quote:string; sourceTitle:string; url?:string; sourceNote?:{id:string;revision:number};
}
interface MethodStep {
  id:string; title:string; detail:string; component:string; input:string; output:string; standard:string; quote:string;
  url:string; start:number; digest:string;
}
type MethodSource =
  | {kind:'note';title:string;noteId:string;revision:number;field:'body'|'title'}
  | {kind:'url';title:string;url:string;partial?:boolean}
  | {kind:'file';title:string;partial?:boolean}
  | {kind:'noteFile';title:string;noteId:string;revision:number;file:OutputAttachment;partial?:boolean};
export interface MethodPreview {
  source:MethodSource; classification:'workflow'|'reference'; reason:string;
  steps:MethodStep[]; links:{from:string;to:string;label:string}[];
}
export interface MethodSummaryInput {
  title:string;
  steps:{id:string;title:string;detail:string;input?:string;output?:string;standard?:string}[];
  links:{from:string;to:string;label:string;detail:string}[];
}
export async function summarizeMethod(title:string, board:InspirationBoard, notes:KnowledgeNote[]):Promise<string> {
  const host=desktopHost();
  if(!host?.summarizeMethod) throw Error('请在桌面版连接 Agent 后总结。');
  const names=new Map(notes.map(n=>[n.id,n.title]));
  return host.summarizeMethod({title, steps:board.nodes.map(n=>({
    id:n.noteId,title:n.idea?.title || names.get(n.noteId) || '来源已移除',detail:n.idea?.detail || '',
    input:n.idea?.method?.input,output:n.idea?.method?.output,standard:n.idea?.method?.standard,
  })),links:board.links.map(({from,to,label,detail})=>({from,to,label,detail}))});
}

/** Give independently analysed sources separate rows; only source-supported arcs become connections. */
export function methodFragment(rows:{preview:MethodPreview;file?:OutputAttachment}[]):InspirationBoard {
  const board:InspirationBoard={nodes:[],links:[]};
  let top=74;
  for(const {preview,file} of rows) {
    const source=preview.source;
    const ids=new Map(preview.steps.map(step=>[step.id,crypto.randomUUID()]));
    const parents=new Map<string,string[]>(preview.steps.map(s=>[s.id,[]]));
    for(const edge of preview.links) parents.get(edge.to)!.push(edge.from);
    const levels=new Map<string,number>();
    function level(id:string):number {
      const existing=levels.get(id);
      if(existing!==undefined)return existing;
      const depth=Math.max(-1,...(parents.get(id) ?? []).map(level))+1;
      levels.set(id,depth);
      return depth;
    }
    const slots=new Map<number,number>();
    let last=top;
    preview.steps.forEach((s,i)=>{
      const depth=preview.classification==='reference'?i%3:level(s.id);
      const row=slots.get(depth)??0;
      slots.set(depth,row+1);
      const y=top+row*(NODE_HEIGHT+65);
      const idea:CanvasIdea={title:s.title,detail:s.detail,origin:'manual',
        method:{component:s.component,input:s.input,output:s.output,standard:s.standard,
          quote:s.quote,sourceTitle:source.title,...(source.kind==='noteFile'&&{sourceNote:{id:source.noteId,revision:source.revision}}),...(s.url&&{url:s.url})}};
      if(source.kind==='note') {
        idea.origin='extracted';idea.source={noteId:source.noteId,revision:source.revision,field:source.field,start:s.start,end:s.start+s.quote.length,digest:s.digest};
      }else {
        idea.origin='reference';
        if(source.kind==='url')idea.reference={url:source.url};
        else {
          const attachment=source.kind==='noteFile'?source.file:file;
          if(!attachment)throw Error('缺少原文件，请重新导入。');
          idea.reference={file:attachment};
        }
      }
      board.nodes.push({noteId:ids.get(s.id)!,x:48+depth*(NODE_WIDTH+96),y,idea});
      last=Math.max(last,y);
    });
    board.links.push(...preview.links.map(e=>({id:crypto.randomUUID(),from:ids.get(e.from)!,to:ids.get(e.to)!,label:e.label,
      detail:'',reverseDetail:''})));
    top=last+NODE_HEIGHT+88;
  }
  return board;
}
