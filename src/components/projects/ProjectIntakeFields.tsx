import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ProjectIntake } from '../../data/projectIntake';
import { fileSize } from '../../data/outputFiles';
import { MAX_ATTACHMENT_BYTES, MAX_TASK_ATTACHMENTS } from '../../data/taskAttachments';
import { Icon } from '../ui/Icon';
import './project-create.css';

function ReferenceFile({file,onRemove}: {file: File; onRemove: () => void}) {
  const [thumbnail,setThumbnail] = useState('');
  useEffect(() => {
    if (!file.type.startsWith('image/')) {setThumbnail(''); return;}
    const url = URL.createObjectURL(file);
    setThumbnail(url);
    return () => URL.revokeObjectURL(url);
  },[file]);
  return <div className="qp-uploaded-file">
    {thumbnail ? <img src={thumbnail} alt=""/> : <Icon name="folder" size={18}/>}
    <span>{file.name}<small>{fileSize(file.size)}</small></span>
    <button type="button" className="qp-icon" aria-label={'移除 '+file.name} onClick={onRemove}><Icon name="close" size={13}/></button>
  </div>;
}

interface Props {
  value: ProjectIntake;
  update: { (key: Exclude<keyof ProjectIntake,'files'>, value: string): void; (key: 'files', value: File[]): void };
  onError: (message: string) => void;
  compact?: boolean;
  nameLabel?: string;
  destinationAction?: ReactNode;
  disabled?: boolean;
}

export function ProjectIntakeFields({value,update,onError,nameLabel='项目名称',destinationAction,compact=false,disabled=false}: Props) {
  const nameId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const addFiles = (files: File[]) => {
    if (disabled || !files.length) return;
    const all = [...value.files,...files];
    if (all.length > MAX_TASK_ATTACHMENTS || all.some(file=>file.size > MAX_ATTACHMENT_BYTES) || all.reduce((n,file)=>n+file.size,0) > 50*1024*1024) {
      onError('附件最多 20 件，每件最多 25 MB，合计最多 50 MB');
      return;
    }
    update('files',all);
    onError('');
  };
  return <fieldset className="qp-intake" disabled={disabled} aria-label="项目信息">
    <div className="qp-intake-field">
      <div className="qd-destination-heading"><label htmlFor={nameId}>{nameLabel}</label>{destinationAction}</div>
      <input id={nameId} autoFocus={!!destinationAction} required maxLength={80} value={value.name} onChange={event=>update('name',event.target.value)}/>
    </div>
    <label className="qp-intake-field">项目背景（可选）<textarea rows={2} maxLength={16000} value={value.context} onChange={event=>update('context',event.target.value)} placeholder="为什么做这件事？有哪些已知情况或限制？"/></label>
    <label className="qp-intake-field">项目目标<textarea required rows={2} maxLength={2500} value={value.goal} onChange={event=>update('goal',event.target.value)}/></label>
    {!compact && <div className="qp-intake-meta">
      <label className="qp-intake-field">截止日期<input type="date" value={value.deadline} onChange={event=>update('deadline',event.target.value)}/></label>
      <label className="qp-intake-field">负责人<input maxLength={40} value={value.owner} onChange={event=>update('owner',event.target.value)}/></label>
    </div>}
    <div className="qp-create-files">
      <strong>附件 / 参考资料</strong>
      <div className="qp-create-file-list" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();addFiles(Array.from(event.dataTransfer.files));}}>
        <button type="button" className="qp-upload-button" aria-label="添加参考资料" onClick={()=>fileInput.current?.click()}>
          <Icon name="inbox" size={20}/><span>点击上传或拖入文件<small>每件最多 25 MB</small></span>
        </button>
        <input ref={fileInput} aria-label="附件 / 参考文件" hidden multiple type="file" onChange={event=>{addFiles(Array.from(event.target.files ?? []));event.target.value='';}}/>
        {value.files.map((file,index)=><ReferenceFile key={index} file={file} onRemove={()=>update('files',value.files.filter((_,i)=>i!==index))}/>)}
      </div>
    </div>
  </fieldset>;
}

export function ProjectConflictActions({onUse,onNew,disabled}: {onUse:()=>void;onNew:()=>void;disabled:boolean}) {
  return <div className="qp-actions qp-creation-conflict">
    <button type="button" className="qp-btn" disabled={disabled} onClick={onUse}>使用已创建的项目</button>
    <button type="button" className="qp-btn" disabled={disabled} onClick={onNew}>保留填写，另建新草稿</button>
  </div>;
}
