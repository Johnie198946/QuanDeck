import type { CSSProperties } from 'react';
import type { Snapshot } from '../../data/types';
import { deriveResultMetrics, RESULT_BUCKET_LABEL } from '../../data/resultMetrics';
import type { ResultBucket } from '../../data/resultMetrics';
import { formatDuration, formatTokens } from '../../data/format';
import { WORK_LABEL } from '../../data/orchestration';
import { dateInZone, timeInZone } from '../../data/timeline';
import { resultComposition } from '../../data/results';
import { Icon } from '../ui/Icon';
import './result-metrics.css';

const buckets: ResultBucket[] = ['done', 'running', 'attention', 'pending', 'cancelled'];
const color = (value: string) => ({ '--result-tint': value } as CSSProperties);

export function ResultMetrics({ snap, taskId, itemId, onSelect }: {
  snap: Snapshot; taskId: string; itemId: string | null; onSelect?: (itemId: string | null) => void;
}) {
  const m = deriveResultMetrics(snap, taskId, itemId);
  const outputs = resultComposition(m.reports);
  const shownBuckets = buckets.filter(bucket => m.counts[bucket] > 0);
  const allocations = [...m.tokens].sort((a, b) => b.tokens - a.tokens);
  const statusLabel = m.status ? WORK_LABEL[m.status as keyof typeof WORK_LABEL] ?? '待推进' : '待推进';
  const timedReports = m.reports.filter(report => Number.isFinite(report.timestamp));
  const from = timedReports[0]?.timestamp;
  const to = timedReports.at(-1)?.timestamp;
  const timeLabel = (timestamp: number) => {
    const zone = snap.project.timeZone ?? 'Asia/Shanghai';
    const date = dateInZone(timestamp, zone);
    return `${date === snap.date ? '' : `${date.slice(5).replace('-', '/')} `}${timeInZone(timestamp, zone)}`;
  };
  let offset = 0;
  return <div className="qd-result-metrics" aria-label="当前任务成果统计">
    <section className="qd-result-metric-progress" aria-labelledby="result-progress-heading">
      <h2 id="result-progress-heading">{m.children.length ? itemId ? '下级任务进度' : '主任务进度' : '执行进度'}</h2>
      <div className="qd-result-metric-progress-body">
        <div className="qd-result-ring" role="img" aria-label={m.ratio != null ? `${m.completed}/${m.total} ${m.children.length ? '直属子任务' : m.manual ? '任务' : '步骤'}完成` : `${statusLabel}，未提供总步骤`}>
          <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="qd-result-ring-track" cx="50" cy="50" r="41" />
            {m.children.length ? shownBuckets.map(bucket => {
              const length = m.counts[bucket] / m.children.length * 100;
              const start = offset; offset += length;
              return <circle key={bucket} className={`qd-result-ring-segment tone-${bucket}`} cx="50" cy="50" r="41" pathLength="100" strokeDasharray={`${Math.max(.1, length - 1.8)} 100`} strokeDashoffset={-start} />;
            }) : m.ratio != null ? <circle className="qd-result-ring-segment tone-done" cx="50" cy="50" r="41" pathLength="100" strokeDasharray={`${m.ratio * 100} 100`} /> : null}
          </svg>
          <span>{m.ratio != null ? <><strong>{m.completed}<small>/{m.total}</small></strong><em>已完成</em></> : <><strong className="is-label">{statusLabel}</strong><em>步骤待同步</em></>}</span>
        </div>
        {m.children.length ? <div className="qd-result-metric-legend">{shownBuckets.map(bucket => <span key={bucket} className={`tone-${bucket}`}><i />{RESULT_BUCKET_LABEL[bucket]}<b>{m.counts[bucket]}</b></span>)}</div> : <p className="qd-result-metric-note">{m.manual ? '我来完成' : m.ratio != null ? '源会话同步的步骤' : '按最新执行状态更新'}</p>}
      </div>
    </section>
    <section className="qd-result-metric-tokens" aria-labelledby="result-token-heading">
      {m.tokenValue == null ? <><header><h2 id="result-token-heading">成果构成</h2><span>{outputs.total} 份成果</span></header><p className="qd-result-metric-number">{outputs.human}<small>人工</small> <span className="qd-output-plus">+</span> {outputs.agent}<small>Agent</small></p><div className="qd-compact-output-types">{([["文字",outputs.text],["链接",outputs.links],["文件",outputs.files]] as [string,number][]).map(([label,n]) => <span key={label}><b>{n}</b>{label}</span>)}</div></> : <><header><h2 id="result-token-heading">Token 分配</h2><span>{m.partialTokens ? '部分已同步' : '已记录'}</span></header>
      <p className="qd-result-metric-number">{m.tokenValue != null ? <>{m.partialTokens && '≥ '}{formatTokens(m.tokenValue).replace(' token', '')}<small>token</small></> : <span className="is-unknown">待同步</span>}</p>
      <div className="qd-token-allocation" aria-label="各分支 Token 占比">
        {m.tokenValue ? allocations.filter(row => row.tokens > 0).map(row => <button type="button" key={row.id} style={{ ...color(row.color), flex: row.tokens }} title={`${row.title} · ${row.unknown ? '至少 ' : ''}${formatTokens(row.tokens)}`} aria-label={`${row.title}，${formatTokens(row.tokens)}，查看任务`} onClick={() => onSelect?.(row.itemId)} disabled={!onSelect} />) : <span className="qd-token-empty" />}
      </div>
      <div className="qd-token-labels">{allocations.filter(row => row.tokens > 0).slice(0, 2).map(row => <button type="button" key={row.id} onClick={() => onSelect?.(row.itemId)} disabled={!onSelect}><span title={row.title}>{row.title}</span><b>{formatTokens(row.tokens).replace(' token', '')}</b></button>)}{!allocations.some(row => row.tokens > 0) && <span>收到用量后显示分配</span>}</div></>}
    </section>
    <section className="qd-result-metric-outputs" aria-labelledby="result-output-metric-heading">
      <header><h2 id="result-output-metric-heading">成果足迹</h2><span>{m.reports.length} 份成果</span></header>
      {timedReports.length ? <>
        <div className="qd-output-milestones" aria-label="成果提交的时间分布">
          {timedReports.map(report => {
            const position = from != null && to != null && to > from ? (report.timestamp - from) / (to - from) * 100 : 50;
            return <button type="button" key={report.id} style={{ left: `${position}%`, top: `${18 + (timedReports.filter(r => r.timestamp === report.timestamp).findIndex(r => r.id === report.id) % 3) * 8}px` }} title={`${report.at} · ${report.title}`} aria-label={`${timeLabel(report.timestamp)}，${report.title}，查看成果`} onClick={() => onSelect?.(report.itemId ?? null)} disabled={!onSelect}><Icon name="check" size={10} /></button>;
          })}
        </div>
        <div className="qd-output-axis"><span>{timeLabel(from!)}</span>{timedReports.length > 1 && <span>{timeLabel(to!)}</span>}</div>
      </> : <p className="qd-result-no-footprints">{m.reports.length ? '成果时间待同步' : '等待第一份成果'}</p>}
      {m.activeMinutes != null && <p className="qd-result-active-time"><Icon name="clock" size={13} />今日运行 <strong>{m.activeMinutes == null ? '待同步' : formatDuration(m.activeMinutes)}</strong><span>并行去重</span></p>}
    </section>
  </div>;
}
