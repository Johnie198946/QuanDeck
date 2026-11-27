import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../ui/Icon';
import type { SelectedPassage } from './noteSelectionRange';
import { NoteQuestionMaterials } from './NoteQuestionMaterials';
import type { NoteExpansion, NoteQuestionContext, QuestionMaterials } from '../../data/knowledgeNotes';
import './note-selection.css';

type Props = {
  passage: SelectedPassage; surrounding: NoteQuestionContext; busy: boolean; error: string; hasPublicLinks: boolean;
  onDismiss: () => void; onSend: () => Promise<string | undefined>; onAsk: (question: string, readPublic: boolean, materials:QuestionMaterials) => void;
};

export function NoteSelectionPrompt({passage, surrounding, busy, error, hasPublicLinks, onDismiss, onAsk, onSend}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [sendFailure, setSendFailure] = useState<{passage: SelectedPassage; reason: string}>();
  const [readPublic, setReadPublic] = useState(false);
  const [materials,setMaterials]=useState<QuestionMaterials>({});
  const tooLong = passage.label.length > 6000;
  const selectedQuestion = /[？?]$|^(?:请问|如何|怎么|为什么|是否|还有多少|我还有多少)/u.test(passage.label.trim()) && passage.label.trim().length <= 1200
    ? passage.label.trim() : '';
  const prompt = question.trim() || selectedQuestion;

  useLayoutEffect(() => {
    if (!open || typeof Highlight !== 'function') return;
    CSS.highlights.set('qd-current-question', new Highlight(passage.range));
    return () => { CSS.highlights.delete('qd-current-question'); };
  }, [open,passage]);

  useLayoutEffect(() => {
    const element = panel.current;
    const parent = passage.range.commonAncestorContainer.parentElement;
    if (!element || !parent) return;
    const editor = parent.closest<HTMLElement>('[contenteditable]');
    const header = editor?.closest('.qd-note-edit')?.querySelector('.qd-note-sticky-header');
    const viewport = window.visualViewport;
    function position() {
      if (!element) return;
      const rects = Array.from(passage.range.getClientRects()).filter(rect => rect.width && rect.height);
      const bounds = editor?.getBoundingClientRect();
      const left = Math.max(viewport?.offsetLeft ?? 0, bounds?.left ?? 0) + 6;
      const right = Math.min((viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth), bounds?.right ?? innerWidth) - 6;
      let top = viewport?.offsetTop ?? 0, bottom = top + (viewport?.height ?? innerHeight);
      for (let ancestor = parent; ancestor; ancestor = ancestor.parentElement) {
        if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(ancestor).overflowY)) continue;
        const rect = ancestor.getBoundingClientRect();
        top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom);
      }
      if (header) top = Math.max(top, header.getBoundingClientRect().bottom);
      element.style.visibility = 'hidden';
      // A multi-paragraph selection can extend past the viewport, especially with inline answers.
      const anchor = rects.filter(rect => rect.bottom > top && rect.top < bottom && rect.right >= left && rect.left <= right).at(-1);
      if (!anchor || right <= left) return;
      element.style.maxWidth = Math.floor(right - left) + 'px';
      const width = element.offsetWidth, height = element.offsetHeight;
      const fitsAfter = anchor.right + 6 + width <= right;
      const x = Math.max(left, Math.min(right-width, fitsAfter ? anchor.right+6 : anchor.right-width));
      const y = !open && fitsAfter ? (anchor.top+anchor.bottom-height)/2
        : anchor.bottom+height+5 <= bottom || anchor.top-height-5 < top ? anchor.bottom+5 : anchor.top-height-5;
      element.style.left = x + 'px';
      element.style.top = Math.max(top+4,Math.min(y,bottom-height-4)) + 'px';
      element.style.visibility = 'visible';
    }
    position();
    const resize = new ResizeObserver(position);
    resize.observe(element);
    if (editor) resize.observe(editor);
    if (header) resize.observe(header);
    document.addEventListener('scroll',position,true);
    window.addEventListener('resize',position);
    viewport?.addEventListener('resize',position);
    viewport?.addEventListener('scroll',position);
    return () => { resize.disconnect(); document.removeEventListener('scroll',position,true); window.removeEventListener('resize',position);
      viewport?.removeEventListener('resize',position); viewport?.removeEventListener('scroll',position); };
  }, [passage,open]);
  useLayoutEffect(() => { if (open) input.current?.focus({preventScroll:true}); }, [open]);
  const cancel = useCallback(() => {
    const range = passage.range.cloneRange(); range.collapse(false);
    const editor = panel.current?.closest('.qd-note-edit')?.querySelector<HTMLElement>('.qd-writer-content');
    editor?.focus({preventScroll:true});
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    onDismiss();
  }, [passage,onDismiss]);
  useEffect(() => {
    const outside = (event: PointerEvent | FocusEvent) => {
      if (busy || !(event.target instanceof Node) || panel.current?.contains(event.target)) return;
      if (event.type === 'focusin' && event.target instanceof Element && event.target.closest('.qd-writer-content') && !open) return;
      onDismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || busy) return;
      event.preventDefault();
      cancel();
    };
    document.addEventListener('pointerdown',outside,true); document.addEventListener('focusin',outside,true);
    document.addEventListener('keydown',escape);
    return () => { document.removeEventListener('pointerdown',outside,true); document.removeEventListener('focusin',outside,true); document.removeEventListener('keydown',escape); };
  }, [busy,onDismiss,cancel,open]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (prompt && !tooLong && !busy) onAsk(prompt,readPublic,materials);
  }
  return <div className={'qd-passage-popover'+(open ? ' is-open':'')} ref={panel} data-note-prompt>
    {!open ? <div className="qd-passage-actions" role="group" aria-label="选段操作"><button type="button" className="qd-passage-trigger" aria-label="就这段提问" title="就这段提问" aria-haspopup="dialog"
      onMouseDown={event=>event.preventDefault()} onClick={()=>setOpen(true)}><Icon name="ask-ai" size={16}/></button>
      <button type="button" className="qd-passage-trigger" title="发给帮你管" aria-label="发送选段到帮你管" disabled={busy} onMouseDown={event => event.preventDefault()} onClick={async () => {
        setSendFailure(undefined);
        const reason = await onSend();
        if (reason) setSendFailure({ passage, reason });
      }}><Icon name="plane" size={16}/></button>
      {sendFailure?.passage === passage && <small className="qd-selection-send-error" role="alert">{sendFailure.reason}</small>}
      </div>
    : <form role="dialog" aria-label="就这段提问" className="qd-passage-form" onSubmit={submit}>
      <div className="qd-passage-context"><span title={passage.label}>{passage.label}</span>
        <button type="button" aria-label="取消" title="取消" disabled={busy} onClick={cancel}><Icon name="close" size={15}/></button></div>
      <div className="qd-passage-question"><input ref={input} aria-label="补充问题" maxLength={1200} value={question} placeholder={selectedQuestion ? "直接发送选中的问题，或补充说明" : "想问这段什么？"}
        disabled={busy} onChange={event=>setQuestion(event.target.value)} onKeyDown={event=>{ if(event.key==='Enter' && event.nativeEvent.isComposing) event.preventDefault(); }}/>
        <button type="submit" aria-label="问 AI 并追加" title="问 AI 并追加" disabled={!prompt || busy || tooLong}><Icon name="send" size={15}/></button></div>
      <NoteQuestionMaterials surrounding={surrounding} quote={passage.label} newQuestion onChange={setMaterials}/>
      {hasPublicLinks && <label className="qd-passage-sources"><input type="checkbox" checked={readPublic} disabled={busy} onChange={event=>setReadPublic(event.target.checked)}/>读取笔记里的公开网页并交给 AI 分析</label>}
      {(busy || tooLong || error) && <small role="status">{busy?'正在回答…':tooLong?'请将选段缩短到 6000 字以内。':error}</small>}
    </form>}
  </div>;
}


export function NoteFollowUp({answer,onDismiss,onAsk}:{answer:NoteExpansion;onDismiss:()=>void;onAsk:(question:string,materials:QuestionMaterials)=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  const [question,setQuestion]=useState('');
  const [materials,setMaterials]=useState<QuestionMaterials>({});
  useEffect(()=>{const dialog=ref.current; dialog?.showModal();return ()=>dialog?.close()},[]);
  return <dialog ref={ref} className="qd-handoff-dialog qd-followup" aria-label="追问这个回答" onCancel={onDismiss}>
    <form onSubmit={e=>{e.preventDefault();if(question.trim())onAsk(question.trim(),materials)}}>
      <strong>追问这个回答</strong><small>{answer.question}</small>
      <textarea autoFocus rows={2} aria-label="追问" placeholder="还想问什么？" value={question} maxLength={1200} onChange={e=>setQuestion(e.target.value)}/>
      <NoteQuestionMaterials onChange={setMaterials}/>
      <footer><button type="button" onClick={onDismiss}>取消</button><button disabled={!question.trim()}>发送追问</button></footer>
    </form>
  </dialog>;
}
