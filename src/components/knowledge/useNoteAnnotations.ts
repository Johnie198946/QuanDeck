import { useLayoutEffect, type RefObject } from 'react';
import type { NoteExpansion } from '../../data/knowledgeNotes';
import { resolveNoteRange } from './noteSelectionRange';

// Cards live outside contenteditable so selecting, copying and saving the original text
// never picks up the answers. Reserve their space underneath the referenced paragraph.
export function useNoteAnnotations(shell: RefObject<HTMLElement | null>, body: string, items?: Pick<NoteExpansion,'id'|'selection'>[]) {
  useLayoutEffect(() => {
    const sheet = shell.current;
    const editor = sheet?.querySelector<HTMLElement>('.qd-writer-content');
    const source = sheet?.querySelector<HTMLElement>('[data-note-source]');
    const cards = Array.from(sheet?.querySelectorAll<HTMLElement>('[data-answer-id]') ?? []);
    if (!sheet || !editor || !source || !items?.length || !cards.length) return;
    const originalLabels = new Map<HTMLElement, string>();
    const byId = new Map(cards.map(card => [card.dataset.answerId, card]));
    const blocks = new Map<HTMLElement, HTMLElement[]>();
    const colors: Range[][] = [[], []];
    for (const [index, item] of items.entries()) {
      const card = byId.get(item.id);
      const range = resolveNoteRange(editor, source, body, item.selection);
      if (!card || !range) continue;
      const label = card.querySelector<HTMLElement>('[data-answer-quote]');
      if (label) { originalLabels.set(label, label.textContent ?? ''); label.textContent = range.toString(); }
      colors[index % colors.length].push(range);
      const end = range.endContainer instanceof HTMLElement ? range.endContainer : range.endContainer.parentElement;
      // A note can be one long numbered list. Attach to the selected item inside it.
      const block = end?.closest<HTMLElement>('li, table, pre, p, blockquote, h1, h2, h3, h4, h5, h6, div');
      if (!block || block === editor || !editor.contains(block)) continue;
      const group = blocks.get(block) ?? [];
      group.push(card);
      blocks.set(block, group);
    }
    const tones = ['qd-note-quote-blue', 'qd-note-quote-violet'];
    if (typeof Highlight === 'function') colors.forEach((ranges, i) => CSS.highlights.set(tones[i], new Highlight(...ranges)));
    let frame = 0;
    function layout() {
      for (const [block, group] of blocks) {
        let gap = 8;
        for (const card of group) {
          card.dataset.anchored = 'true';
          card.style.top = (block.getBoundingClientRect().bottom - sheet!.getBoundingClientRect().top - sheet!.clientTop + gap) + 'px';
          gap += card.offsetHeight + 8;
        }
        block.style.setProperty('--qd-answer-space', gap + 'px');
        block.dataset.hasAnswer = 'true';
      }
    }
    function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); }
    layout();
    const observer = new ResizeObserver(schedule);
    observer.observe(editor);
    observer.observe(sheet);
    for (const card of cards) observer.observe(card);
    sheet.addEventListener('load', schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      sheet.removeEventListener('load', schedule, true);
      for (const [label, original] of originalLabels) label.textContent = original;
      for (const [block] of blocks) {
        delete block.dataset.hasAnswer;
        block.style.removeProperty('--qd-answer-space');
      }
      for (const card of cards) { delete card.dataset.anchored; card.style.removeProperty('top'); }
      if (typeof Highlight === 'function') tones.forEach(name => CSS.highlights.delete(name));
    };
  }, [shell, body, items]);
}
