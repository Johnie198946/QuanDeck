import { useId, useRef, useState } from 'react';
import { Icon, type IconName } from '../ui/Icon';
import './note-insert.css';

interface Props {
  disabled: boolean;
  onPicture: () => void;
  onAttach: () => void;
  onLink: () => void;
  onTranscript: () => void;
  onRule: () => void;
  onTable: (rows: number, columns: number) => void;
}

const columns = 6;
const rows = 5;
export function NoteInsertMenu({ disabled, onPicture, onAttach, onLink, onTranscript, onRule, onTable }: Props) {
  const id = useId();
  const popup = useRef<HTMLDivElement>(null);
  const [chooseTable, setChooseTable] = useState(false);
  const [cell, setCell] = useState(0);
  const row = Math.floor(cell / columns);
  const col = cell % columns;
  function insert(action: () => void) {
    popup.current?.hidePopover();
    action();
  }
  const options: [string, IconName, () => void][] = [
    ['表格', 'table', () => { setCell(0); setChooseTable(true); requestAnimationFrame(() => popup.current?.querySelector<HTMLButtonElement>('[data-cell="0"]')?.focus()); }],
    ['图片', 'picture', () => insert(onPicture)],
    ['附件', 'attachment', () => insert(onAttach)],
    ['链接', 'link', () => insert(onLink)],
    ['分隔线', 'rule', () => insert(onRule)],
    ['导入转写', 'pencil', () => insert(onTranscript)],
  ];
  return <div className="qd-writer-tools qd-insert-tools">
    <button type="button" className="qn-insert-button" disabled={disabled} popoverTarget={id} aria-haspopup="dialog">
      <Icon name="plus" size={15}/>插入<Icon name="chevron-down" size={13}/>
    </button>
    <div ref={popup} id={id} className="qn-insert-popup" popover="auto" role="dialog" aria-label="插入内容"
      onToggle={event => { if (event.newState === 'closed') setChooseTable(false); }}>
      {chooseTable ? <>
        <div className="qn-table-heading"><button type="button" aria-label="返回插入菜单" onClick={() => {
          setChooseTable(false);
          requestAnimationFrame(() => popup.current?.querySelector<HTMLButtonElement>('button')?.focus());
        }}><Icon name="chevron-left" size={14}/></button><span aria-live="polite">{row + 1} 行 × {col + 1} 列</span></div>
        <div className="qn-table-grid" role="group" aria-label="选择表格大小">
          {Array.from({ length: rows * columns }, (_, i) => {
            const r = Math.floor(i / columns), c = i % columns;
            return <button type="button" key={i} data-cell={i} tabIndex={i === cell ? 0 : -1}
              className={r <= row && c <= col ? 'is-picked' : ''} aria-label={'插入 ' + (r + 1) + ' 行 ' + (c + 1) + ' 列表格'}
              onPointerEnter={() => setCell(i)} onFocus={() => setCell(i)}
              onKeyDown={event => {
                const step = { ArrowDown: columns, ArrowUp: -columns, ArrowRight: 1, ArrowLeft: -1 }[event.key];
                if (!step) return;
                event.preventDefault();
                const next = Math.max(0, Math.min(rows * columns - 1, i + step));
                popup.current?.querySelector<HTMLButtonElement>('[data-cell="' + next + '"]')?.focus();
              }}
              onClick={() => insert(() => onTable(r + 1, c + 1))}/>;
          })}
        </div>
      </> : options.map(([label, icon, action]) => <button type="button" className="qn-insert-item" key={label} onClick={action}>
        <Icon name={icon} size={17}/><span>{label}</span>{label === '表格' && <Icon name="chevron-right" size={14}/>}
      </button>)}
    </div>
  </div>;
}
