import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { KNOWLEDGE_FILES } from '../../data/knowledgeNotes';
import { fileSize, downloadOutputFile } from '../../data/outputFiles';
import { readNoteFilePreview } from '../../data/noteFilePreview';
import type { OutputAttachment } from '../../data/types';
import type { RuntimeAttachmentPreview } from '../../integration/desktop';
import { PreviewBody } from '../runtime/AttachmentPreview';
import { Icon } from '../ui/Icon';
import './note-inline-cards.css';

export function safeNoteUrl(value: string) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function LinkCard({ url, label }: { url: string; label: string }) {
  const href = safeNoteUrl(url);
  if (!href) return <span>{label}</span>;
  const address = new URL(href);
  return <a className="qn-link-card" href={href} target="_blank" rel="noopener noreferrer" title={href}>
    <Icon name="link" size={18}/><span><strong>{!label || label === href || label === url ? address.host : label}</strong><small>{href}</small></span><Icon name="external" size={14}/>
  </a>;
}

function FileSummary({data}: {data:RuntimeAttachmentPreview}) {
  if (data.kind === 'spreadsheet') {
    const sheet = data.sheets[0];
    return <div className="qn-file-grid">{sheet?.rows.length ? <table aria-label={sheet.name}><tbody>{sheet.rows.slice(0, 3).map(row =>
      <tr key={row.number}>{row.cells.slice(0, 4).map((cell, i) => <td key={i}>{cell.text || cell.formula}</td>)}</tr>)}</tbody></table> : '工作表为空'}</div>;
  }
  if (data.kind === 'document') {
    const lines = data.blocks.map(block => block.kind === 'table' ? block.rows[0]?.join(' · ') : block.text).filter(Boolean);
    return <p className="qn-file-excerpt">{lines.slice(0, 3).join('\n') || '文档没有可提取的文字'}</p>;
  }
  if (data.kind === 'slides') return <p className="qn-file-excerpt">{data.slides[0]?.slice(0,3).join('\n') || '第一页没有可提取的文字'}</p>;
  if (data.kind === 'text') return <p className="qn-file-excerpt">{data.text.slice(0, 420)}</p>;
  if (data.kind === 'pdf' || data.kind === 'image') return <div className="qn-file-thumbnail"><PreviewBody data={data}/></div>;
  return null;
}

export function NoteFileCard({noteId, file, label, pending = false}: {noteId:string; file?:OutputAttachment; label:string; pending?:boolean}) {
  const card = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const [visible,setVisible] = useState(false), [open,setOpen] = useState(false);
  const [preview,setPreview] = useState<RuntimeAttachmentPreview>(), [error,setError] = useState(''), [downloadError,setDownloadError] = useState('');
  useEffect(() => {
    if (visible || !card.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '100px' });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!file || !visible) return;
    let current = true;
    setError(''); setPreview(undefined);
    readNoteFilePreview(noteId,file).then(value => { if(current)setPreview(value); })
      .catch(reason => { if(current)setError(reason instanceof Error ? reason.message : '暂时无法预览'); });
    return () => { current=false; };
  }, [noteId,file?.id,visible]);
  useEffect(() => { if(open)dialog.current?.showModal(); },[open]);
  const name = file?.name || label;
  const extension = name.includes('.') ? name.split('.').at(-1)!.toUpperCase().slice(0,6) : '文件';
  async function download() {
    if (!file) return;
    setDownloadError('');
    try { await downloadOutputFile(KNOWLEDGE_FILES,file); }
    catch(cause) { setDownloadError(cause instanceof Error ? cause.message : '未能下载原件'); }
  }
  return <div ref={card} className="qn-file-card" role="group" aria-label={'附件预览 · '+name}>
    <div className="qn-file-heading"><span className="qn-file-type" data-type={extension}>{extension}</span><strong>{name}</strong>{file && <small>{fileSize(file.size)}</small>}</div>
    {preview ? <FileSummary data={preview}/> : <p className="qn-file-status">{error || (pending ? '正在保存附件…' : file ? '正在读取预览…' : '未找到附件记录')}</p>}
    {file && <div className="qn-file-actions">{preview && <button type="button" aria-label={'展开预览 '+name} onClick={() => setOpen(true)}><Icon name="expand" size={13}/>展开预览</button>}
      <button type="button" aria-label={'下载 '+name} onClick={() => void download()}>下载原件</button></div>}
    {downloadError && <p role="alert">{downloadError}</p>}
    {open && preview && createPortal(<dialog ref={dialog} className="qd-inline-attachment-dialog" aria-label={name+' 预览'} onClose={() => setOpen(false)}>
      <header><h2>{name}</h2><button type="button" aria-label="关闭预览" onClick={() => dialog.current?.close()}><Icon name="close" size={18}/></button></header>
      <div className="qd-inline-attachment-body"><PreviewBody data={preview}/></div></dialog>,document.body)}
  </div>;
}

type CardSlot = {node:HTMLElement; host:HTMLElement; key:number; value:string; label:string; link:boolean};
export function NoteInlineCards({content,noteId,files,incoming}: {
  content:RefObject<HTMLElement|null>; noteId:string; files:OutputAttachment[]; incoming:OutputAttachment[];
}) {
  const [slots,setSlots]=useState<CardSlot[]>([]);
  useLayoutEffect(() => {
    const editor=content.current;
    if (!editor) return;
    let last:CardSlot[]=[];
    let sequence=0;
    function scan(){
      const next=Array.from(editor!.querySelectorAll<HTMLElement>('[data-note-file],[data-note-link]')).map(node=>{
        const previous=last.find(slot=>slot.node===node);
        const host=previous?.host ?? document.createElement('span');
        if (host.parentNode!==node) node.replaceChildren(host);
        return {node,host,key:previous?.key ?? ++sequence,value:node.dataset.noteFile || node.dataset.noteLink || '',label:node.dataset.label || '',link:!!node.dataset.noteLink};
      });
      if (last.length===next.length && next.every((slot,i)=>slot.node===last[i].node && slot.value===last[i].value && slot.label===last[i].label)) return;
      last=next;setSlots(next);
    }
    scan();
    const observer=new MutationObserver(scan);
    observer.observe(editor,{childList:true,subtree:true,attributes:true,attributeFilter:['data-note-file','data-note-link','data-label']});
    return ()=>observer.disconnect();
  },[content]);
  return <>{slots.map(slot=>createPortal(slot.link ? <LinkCard url={slot.value} label={slot.label}/> :
    <NoteFileCard file={files.find(file=>file.id===slot.value)} noteId={noteId} label={slot.label}
      pending={slot.value.startsWith('pending-') || incoming.some(file=>file.id===slot.value)}/>,slot.host,String(slot.key)))}</>;
}
