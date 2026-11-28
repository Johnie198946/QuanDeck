import { useEffect, useState } from 'react';
import type { CollaborationArtifact } from '../../data/collaboration';
import type { Snapshot } from '../../data/types';
import { readOutputBlob } from '../../data/outputFiles';
import { KNOWLEDGE_FILES } from '../../data/knowledgeNotes';
import { desktopHost } from '../../integration/desktop';
import { VisualPhoto } from '../discussion/VisualMedia';
import { OutputPictures, StoredPicture } from '../outputs/ArtifactThumbnail';
import type { ReviewCheckRow } from '../outputs/reviewChecklist';
import { ResultMarkdown } from './ResultDocument';
import './review-evidence.css';

const imageRef = /^!\[([^\]]*)\]\(attachment:([\w-]+)\)$/;
export function reviewGroups(rows: ReviewCheckRow[]) {
  const groups: { text:string; indexes:number[]; images:{name:string;id:string}[]; heading:string }[] = [];
  let heading = '', pending:number[] = [];
  for (const row of rows) {
    const text = row.text.trim().replace(/^[-*]\s+/, ''), image = text.match(imageRef);
    if (image && groups.length && !pending.length) {
      const last = groups[groups.length - 1]; last.images.push({name:image[1],id:image[2]}); last.indexes.push(...row.taskIndexes);
    } else if (!image && /[:：]$/.test(text) && text.length < 40) {
      heading = text; pending.push(...row.taskIndexes);
    } else {
      groups.push({text:image ? '核对原要求配图' : text,heading,indexes:[...pending,...row.taskIndexes],images:image?[{name:image[1],id:image[2]}]:[]}); pending=[];
    }
  }
  if (pending.length) groups.push({text:heading,heading:'',indexes:pending,images:[]});
  return groups;
}

function OriginalPicture({ noteId, id, name }: {noteId?:string;id:string;name:string}) {
  const [url,setUrl] = useState(''), [failed,setFailed] = useState(false);
  useEffect(()=>{let active=true, objectUrl='';setUrl('');setFailed(false);
    if (!noteId) { setFailed(true); return; }
    const host=desktopHost(); const blob=host?.readKnowledgeImage ? host.readKnowledgeImage(noteId,id).then(bytes=>new Blob([Uint8Array.from(bytes)])) : readOutputBlob(KNOWLEDGE_FILES,id);
    void blob.then(value=>{if(active){objectUrl=URL.createObjectURL(value);setUrl(objectUrl);}}).catch(()=>{if(active)setFailed(true)});
    return ()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)};
  },[id,noteId]);
  return url ? <VisualPhoto localUrl={url} alt={name || '原要求配图'}/> : <small>{failed?'原图未能读取，请补充原图':'正在载入原图…'}</small>;
}

function Candidate({artifact,projectId}:{artifact:CollaborationArtifact;projectId:string}) {
  const files=artifact.attachments??[], scope=artifact.outputId?{projectId,outputId:artifact.outputId,files}:undefined;
  return <OutputPictures.Provider value={scope}><ResultMarkdown text={artifact.body || '这版没有提交成果说明。'} runId={artifact.runId}/>{scope && files.filter(file=>/^image\//.test(file.type)&&!artifact.body.includes(file.name)&&!artifact.body.includes(file.id)).map(file=><StoredPicture key={file.id} {...scope} file={file} inline/>)}</OutputPictures.Provider>;
}

export function ReviewEvidence({rows,snapshot,artifact,checks,onCheck,onRequest}:{rows:ReviewCheckRow[];snapshot:Snapshot;artifact:CollaborationArtifact;checks:boolean[];onCheck:(indexes:number[],checked:boolean)=>void;onRequest:(text:string)=>void}) {
  const ledger=snapshot.collaboration!, task=ledger.tasks[artifact.key],inputs=snapshot.tasks[task.taskId]?.inputs??[];
  const ids=new Set(ledger.submissions.filter(sub=>sub.key===task.key&&sub.specRevision===task.specRevision).map(sub=>sub.artifactId));
  const previous=ledger.artifacts.filter(item=>ids.has(item.id)&&item.version<artifact.version&&item.key===artifact.key).sort((left,right)=>right.version-left.version)[0];
  const groups=reviewGroups(rows), [selected,setSelected]=useState(0); const current=groups[selected];
  if (!current) return null;
  return <div className="qr-evidence"><div className="qr-tabs" aria-label="选择核对要求">{groups.map((group,index)=><button type="button" key={group.indexes.join(':')} aria-pressed={index===selected} onClick={()=>setSelected(index)}>要求 {index+1}{group.indexes.every(idx=>checks[idx])?' ✓':''}</button>)}</div><div className="qr-columns"><section><small>原要求 {selected+1} / {groups.length}</small><h4>{current.heading}</h4><p>{current.text}</p>{current.images.map(image=><OriginalPicture key={image.id} {...image} noteId={inputs.find(input=>input.noteSource && input.text.includes('attachment:'+image.id))?.noteSource?.noteId}/>)}</section><section><small>本次交付 · v{artifact.version}</small><h4>{artifact.title}</h4><Candidate artifact={artifact} projectId={snapshot.project.id}/>{previous?<details><summary>对照上一版 · v{previous.version}</summary><Candidate artifact={previous} projectId={snapshot.project.id}/></details>:<small>没有同一要求下的上一版交付。</small>}</section></div><div className="qr-decide"><label><input type="checkbox" checked={current.indexes.every(idx=>checks[idx])} onChange={event=>onCheck(current.indexes,event.target.checked)}/> 对照后，确认此项符合要求</label><button type="button" onClick={()=>onRequest(`请补充「${current.text}」对应的成果或前后对照。`)}>此项需要补证</button></div></div>;
}
