import { useId } from 'react';
import type { NoteReceipt } from '../../data/noteReceipts';
import type { PresentedResult } from '../../data/resultPresentation';
import type { Snapshot } from '../../data/types';
import { OutputPictures } from '../outputs/ArtifactThumbnail';
import { OutputAssets } from '../outputs/OutputAssets';
import { isVisualDocument, OutputPreview } from '../results/OutputPreview';
import { ResultContent } from '../results/ResultDocument';
import { ResultReply } from '../results/ResultReply';
import { Icon } from '../ui/Icon';
import type { OpenNoteReceipt } from './NoteReceiptMarks';

export function NoteDelivery({ project, entry, taskId }: { project: Snapshot; entry: PresentedResult; taskId: string }) {
  const { record } = entry;
  const outputId = record.outputId;
  const files = record.attachments ?? [];
  const previews = outputId ? files.filter(isVisualDocument) : [];
  const others = files.filter(file => !previews.includes(file));
  return <>
    <OutputPictures.Provider value={outputId ? { projectId: project.project.id, outputId, files: entry.inlineAttachments ?? files } : undefined}>
      <div className="qnr-content"><ResultContent text={record.text} runId={entry.inlineAttachments?.length ? undefined : entry.runId}/></div>
    </OutputPictures.Provider>
    {outputId && previews.map(file => <OutputPreview key={file.id} projectId={project.project.id} outputId={outputId} file={file}/>)}
    {(!!others.length || !!record.links?.length) && <OutputAssets projectId={project.project.id} report={{ ...record, attachments: others }}/>}
    <ResultReply snapshot={project} taskId={taskId} entry={entry}/>
  </>;
}

interface Props {
  row: NoteReceipt;
  expanded: boolean;
  unread: boolean;
  project?: Snapshot;
  onSelect: () => void;
  onOpen: OpenNoteReceipt;
}
export function NoteReceiptDetails({ row, expanded, unread, project, onSelect, onOpen }: Props) {
  const panel = useId();
  const date = row.at && new Date(row.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return <li className="qnr-record" data-expanded={expanded}>
    <button type="button" className="qnr-record-head" onClick={onSelect} aria-expanded={expanded} aria-controls={expanded ? panel : undefined}>
      <span className="qnr-meta">
        <span>{row.kind}</span><span>{row.projectName}</span>{date && <time dateTime={row.at}>{date}</time>}{unread && <i aria-label="未读"/>}
      </span>
      <strong>{row.title}</strong>
    </button>
    {expanded && <div id={panel} className="qnr-record-body">
      {row.entry && project ? <NoteDelivery project={project} taskId={row.taskId} entry={row.entry}/> : row.text && <p>{row.text}</p>}
      <button className="qd-link qnr-source-link" type="button" onClick={() => onOpen(row)}>
        {row.kind === '提醒' ? '处理提醒' : row.kind === '分工' ? '查看相关任务' : '打开这版成果'} <Icon name="external" size={12}/>
      </button>
    </div>}
  </li>;
}
