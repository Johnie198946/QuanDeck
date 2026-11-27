import { locateSelection } from '../../data/knowledgeNotes';
import { useEffect, useRef, useState } from 'react';
import type { Session, Snapshot, OutputAttachment } from '../../data/types';
import type { RuntimeCommands } from '../../data/runtimeContracts';
import { readKnowledge } from '../../data/knowledgeStore';
import { noteDispatchPictures, copyNoteDispatchPictures } from '../../data/noteDispatchPictures';
import { sourceOwner, taskSourceDirectory } from '../../data/taskSourceDirectory';
import { fileSize, saveOutputFile } from '../../data/outputFiles';
import { desktopHost } from '../../integration/desktop';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { checkPendingFiles } from '../workspace/TaskAttachments';
import { DeferredNoteImage } from '../knowledge/NoteThumbnail';
import { Icon } from '../ui/Icon';
import './blocked-task.css';

export function BlockedTaskMaterials({snapshot,session}: {snapshot:Snapshot;session:Session}) {
  const {api,toast} = useWorkdeck();
  const commands = api as Partial<RuntimeCommands>;
  const rt = session.runtime!;
  const projectId = snapshot.project.id, target = sourceOwner(snapshot,rt.taskId,rt.workItemId);
  const previous = target?.inputs?.slice().reverse().find(input=>input.blockedSessionId === session.id);
  const [text,setText] = useState(previous?.text ?? '');
  const [directory,setDirectory] = useState(previous?.sourceDirectory ?? '');
  const [fileList,setFileList] = useState<File[]>([]);
  const [pictures,setPictures] = useState<{noteId:string;file:OutputAttachment}[]>([]);
  const [selected,setSelected] = useState<string[]>([]);
  const [savedFiles,setSavedFiles] = useState(previous?.attachments ?? []);
  const [inputId,setInputId] = useState<string>(previous?.id ?? crypto.randomUUID());
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const lock = useRef(false);
  const host = desktopHost();
  const references = JSON.stringify((snapshot.tasks[rt.taskId]?.inputs ?? []).flatMap(input =>
    input.noteSource?.selection ? [input.noteSource] : []));
  useEffect(()=>{
    let active = true;
    const refs:import('../../data/noteTaskSource').NoteSourceRef[] = JSON.parse(references);
    if (refs.length) void readKnowledge().then(library=>{
      const rows = refs.flatMap(ref=>{
        const note = library.notes.find(n=>n.id === ref.noteId);
        const offset = note && locateSelection(note.body,ref.selection!);
        return note && offset !== undefined ? noteDispatchPictures(note,{...ref.selection!,offset}).map(file=>({noteId:note.id,file})) : [];
      });
      if (active) setPictures([...new Map(rows.map(row=>[row.noteId+':'+row.file.id,row])).values()]);
    }).catch(()=>{});
    return ()=>{active=false;};
  },[references]);
  const change = () => {setInputId(crypto.randomUUID());setError('');};
  const choose = async () => {
    try {
      const path = await host?.chooseDirectory();
      if (path) {setDirectory(path);change();}
    } catch (cause) {setError(cause instanceof Error ? cause.message : '未能打开文件夹选择器');}
  };
  const submit = async () => {
    if (lock.current || !commands.restartBlockedTask) return;
    lock.current = true;setBusy(true);setError('');
    try {
      checkPendingFiles(fileList);
      const files = [...savedFiles];
      for (const {noteId,file} of pictures) {
        if (selected.includes(noteId+':'+file.id)) files.push(...await copyNoteDispatchPictures(projectId,noteId,[file]));
      }
      for (const file of fileList) files.push(await saveOutputFile(projectId,file,true));
      const attachments = [...new Map(files.map(file=>[file.id,file])).values()];
      const receipt = await commands.restartBlockedTask(session.id,{inputId,text,attachments,...(directory && {sourceDirectory:directory})});
      if (receipt.materialsSaved) {setSavedFiles(attachments);setFileList([]);setSelected([]);}
      if (!receipt.ok) throw Error(receipt.message || '派发状态待核对');
      toast(receipt.message ?? '已重新派发');
    } catch (cause) {setError(cause instanceof Error ? cause.message : '材料未能送达');}
    finally {lock.current=false;setBusy(false);}
  };
  return <form className="qd-blocked-materials" aria-label="补充任务材料" onSubmit={event=>{event.preventDefault();void submit();}}>
    <label>补充说明<textarea maxLength={10000} rows={2} value={text} disabled={busy} onChange={event=>{setText(event.target.value);change();}}/></label>
    {pictures.length > 0 && <fieldset><legend>原笔记这一项的图片</legend>{pictures.map(({noteId,file})=>{
      const id = noteId+':'+file.id;
      return <label key={id} className="qd-blocked-picture"><input type="checkbox" disabled={busy} checked={selected.includes(id)}
        onChange={event=>{setSelected(ids=>event.target.checked ? [...ids,id] : ids.filter(item=>item!==id));change();}}/>
        <DeferredNoteImage noteId={noteId} file={file} alt=""/>{file.name}</label>;
    })}</fieldset>}
    <label>添加附件<input aria-label="添加补充附件" type="file" multiple disabled={busy} onChange={event=>{
      const added=Array.from(event.currentTarget.files ?? []);event.currentTarget.value='';
      if (added.length) {setFileList(old=>[...old,...added]);change();}
    }}/></label>
    {savedFiles.map(file=><small key={file.id}>已保存 · {file.name} · {fileSize(file.size)}</small>)}
    {fileList.map((file,index)=><div key={index}>{file.name} · {fileSize(file.size)} <button type="button" className="qd-link" disabled={busy} onClick={()=>{setFileList(old=>old.filter((_,i)=>i!==index));change();}}>移除</button></div>)}
    <div><small>本任务源码目录</small><p>{directory || taskSourceDirectory(snapshot,rt.taskId,rt.workItemId)?.path || rt.connection.projectPath}</p>
      {host?.chooseDirectory && <button type="button" className="qd-btn ghost small" disabled={busy} onClick={()=>void choose()}><Icon name="folder" size={14}/>选择源码文件夹</button>}</div>
    <p>{rt.stoppedConfirmed ? '新一轮会沿用这项任务的要求和成果记录。' : '提交后会先停止原执行，收到停止回执后再开始新一轮。'}</p>
    <button type="submit" className="qd-btn primary" disabled={busy || !commands.restartBlockedTask || !(text.trim() || directory || selected.length || fileList.length || savedFiles.length)}>{busy?'正在处理…':'确认重新派发'}</button>
    {error && <p role="alert" className="qd-inline-error">{error}</p>}
  </form>;
}
