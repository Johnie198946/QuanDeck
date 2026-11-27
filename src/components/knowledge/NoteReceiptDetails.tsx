import { useId } from 'react';
import { blockedTaskSession } from '../../data/blockedTask';
import type { NoteReceipt } from '../../data/noteReceipts';
import { receiptNarrative } from '../../data/receiptNarrative';
import { resultExcerpt, type PresentedResult } from '../../data/resultPresentation';
import type { Snapshot } from '../../data/types';
import { BlockedTaskMaterials } from '../deck/BlockedTaskMaterials';
import { OutputPictures } from '../outputs/ArtifactThumbnail';
import { OutputAssets } from '../outputs/OutputAssets';
import { isVisualDocument, OutputPreview } from '../results/OutputPreview';
import { ResultContent } from '../results/ResultDocument';
import { ResultReply } from '../results/ResultReply';
import { Icon } from '../ui/Icon';
import type { OpenNoteReceipt } from './NoteReceiptMarks';

function ReceiptEvidence({ text }: { text: string }) {
  if (!text) return null;
  return <details className="qnr-evidence"><summary><Icon name="list-bullets" size={14}/>执行记录</summary>
    <pre tabIndex={0} aria-label="执行记录原文">{text}</pre>
  </details>;
}

export function NoteDelivery({ project, entry, taskId, showReply = true }: { project: Snapshot; entry: PresentedResult; taskId: string; showReply?: boolean }) {
  const { record } = entry;
  const outputId = record.outputId;
  const files = record.attachments ?? [];
  const previews = outputId ? files.filter(isVisualDocument) : [];
  const others = files.filter(file => !previews.includes(file));
  const { body, evidence } = receiptNarrative(record.text);
  return <>
    <OutputPictures.Provider value={outputId ? { projectId: project.project.id, outputId, files: entry.inlineAttachments ?? files } : undefined}>
      {body && <div className="qnr-content"><ResultContent text={body} runId={entry.inlineAttachments?.length ? undefined : entry.runId}/></div>}
    </OutputPictures.Provider>
    {outputId && previews.map(file => <OutputPreview key={file.id} projectId={project.project.id} outputId={outputId} file={file}/>)}
    {(!!others.length || !!record.links?.length) && <OutputAssets projectId={project.project.id} report={{ ...record, attachments: others }}/>}
    {showReply && <ResultReply snapshot={project} taskId={taskId} entry={entry}/>}
    <ReceiptEvidence text={evidence}/>
  </>;
}

interface Props {
  row: NoteReceipt;
  expanded: boolean;
  unread: boolean;
  project?: Snapshot;
  onSelect: () => void;
  onOpen: OpenNoteReceipt;
  onContinue?: () => void;
}

function ReceiptMessage({ row, project }: Pick<Props, 'row' | 'project'>) {
  const { body, evidence } = receiptNarrative(row.text);
  const session = row.blockedSessionId && project?.sessions[row.blockedSessionId];
  const canContinue = !!(session && project && blockedTaskSession(project, session));
  // For a blocked run the first paragraph is its request. Keep the agent's
  // complete explanation one disclosure away when it adds more context.
  const paragraphs = canContinue ? body.split(/\n\s*\n/) : [body];
  const [reason, ...context] = paragraphs;
  return <>
    {reason && <div className="qnr-content"><ResultContent text={reason}/></div>}
    {canContinue && <details className="qnr-recover">
      <summary><Icon name="reply" size={15}/>补充材料并继续原任务</summary>
      <BlockedTaskMaterials key={session.id} snapshot={project} session={session}/>
    </details>}
    {!!context.length && <details className="qnr-context"><summary>Agent 补充说明</summary>
      <div className="qnr-content"><ResultContent text={context.join('\n\n')}/></div>
    </details>}
    <ReceiptEvidence text={evidence}/>
  </>;
}

export function NoteReceiptDetails({ row, expanded, unread, project, onSelect, onOpen, onContinue }: Props) {
  const panel = useId();
  const date = row.at && new Date(row.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const alertPrefix = row.kind === '提醒' ? /^([^·]+?) · (.+)$/s.exec(row.title) : null;
  const label = row.blockedSessionId ? '等待补充' : alertPrefix?.[1] || row.kind;
  const version = row.entry?.artifactId && project?.collaboration?.artifacts.find(artifact => artifact.id === row.entry!.artifactId)?.version;
  const excerpt = !expanded && row.kind === '成果' && !version ? resultExcerpt(receiptNarrative(row.text).body, 72) : '';
  const icon = row.kind === '成果' ? 'inbox' : row.kind === '分工' ? 'merge' : 'alert';
  return <li className="qnr-record" data-expanded={expanded} data-kind={row.kind}>
    <button type="button" className="qnr-record-head" onClick={onSelect} aria-expanded={expanded} aria-controls={expanded ? panel : undefined}>
      <span className="qnr-meta">
        <span className="qnr-status"><Icon name={icon} size={13}/>{label}{version ? ' · v' + version : ''}</span>
        <span className="qnr-project">{row.projectName}</span>
        {date && <time dateTime={row.at}>{date}</time>}{unread && <i aria-label="未读"/>}
      </span>
      <strong>{alertPrefix?.[2] || row.title}</strong>
      {excerpt && <span className="qnr-excerpt">{excerpt}</span>}
      <Icon name="chevron-down" size={16}/>
    </button>
    {expanded && <div id={panel} className="qnr-record-body">
      {row.entry && project ? <NoteDelivery project={project} taskId={row.taskId} entry={row.entry}/> : <ReceiptMessage row={row} project={project}/>}
      {onContinue && <button type="button" className="qd-link qnr-source-link" onClick={onContinue}>引用这版发新任务 <Icon name="arrow-right" size={12}/></button>}
      <button className="qd-link qnr-source-link" type="button" onClick={() => onOpen(row)}>
        {row.blockedSessionId ? '在帮你管中查看任务' : row.kind === '提醒' ? '处理提醒' : row.kind === '分工' ? '查看相关任务' : '打开这版成果'} <Icon name="external" size={12}/>
      </button>
    </div>}
  </li>;
}
