import { useEffect, useState } from 'react';
import type { IntegrationChoice, IntegrationInspection } from '../../data/resultIntegration';
import { getIntegrationReviewState } from '../../data/integrationReview';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';

export function IntegrationChecks({ inspection, busy, dirty, onRebase, onPublish }: { inspection: IntegrationInspection; busy: boolean; dirty: boolean; onRebase: (choices: Record<string, IntegrationChoice>) => Promise<void>; onPublish: (note: string) => Promise<void> }) {
  const { api, snap, toast } = useWorkdeck();
  const [choices, setChoices] = useState<Record<string, IntegrationChoice>>({});
  const [reviewed, setReviewed] = useState(false);
  const [note, setNote] = useState('');
  const [requesting, setRequesting] = useState(false);
  const ai = getIntegrationReviewState(snap, inspection.draft.id);
  useEffect(() => { setReviewed(false); }, [ai.review?.id]);
  const checkAI = async () => {
    setRequesting(true);
    try { const response = await api.reviewIntegration(inspection.draft.id, snap.project.id); if (!response.ok) throw new Error(response.message); }
    catch (cause) { toast(cause instanceof Error ? cause.message : '复核未能开始', 'error'); }
    finally { setRequesting(false); }
  };
  const outdated = inspection.draft.baseVersionId !== inspection.currentVersion?.id;
  return <aside className="qd-integration-checks" aria-label="合并检查">
    <header><h3>合并检查</h3><span className={inspection.canPublish ? 'is-clear' : ''}><Icon name={inspection.canPublish ? 'check-circle' : 'alert'} size={15} />{inspection.canPublish ? '结构检查通过' : '有待处理项'}</span></header>
    <div className="qd-integration-diff" aria-label="相对当前版本的章节差异"><span><b>+{inspection.diff.added.length}</b>新增</span><span><b>~{inspection.diff.changed.length}</b>修改</span><span><b>−{inspection.diff.removed.length}</b>移除</span></div>
    {outdated && <section className="qd-integration-check-group"><h4>有更新的已发布版本</h4><p>先合入 v{inspection.currentVersion?.version}，再发布此稿。</p>{inspection.mergeConflicts.map(conflict => <fieldset className="qd-integration-conflict" key={conflict.key}><legend>{conflict.label}</legend><details><summary>比较两份改动</summary><div><strong>我的草稿</strong><pre>{typeof conflict.ours === 'string' ? conflict.ours : JSON.stringify(conflict.ours, null, 2)}</pre><strong>已发布版本</strong><pre>{typeof conflict.theirs === 'string' ? conflict.theirs : JSON.stringify(conflict.theirs, null, 2)}</pre></div></details><label><input type="radio" name={`resolve-${conflict.key}`} checked={choices[conflict.key] === 'ours'} onChange={() => setChoices({ ...choices, [conflict.key]: 'ours' })} />采用我的草稿</label><label><input type="radio" name={`resolve-${conflict.key}`} checked={choices[conflict.key] === 'theirs'} onChange={() => setChoices({ ...choices, [conflict.key]: 'theirs' })} />采用已发布版本</label></fieldset>)}<button type="button" className="qd-btn ghost small" disabled={busy || dirty || inspection.mergeConflicts.some(conflict => !choices[conflict.key])} onClick={() => void onRebase(choices)}>合入更新</button></section>}
    {inspection.issues.length > 0 && <ul className="qd-integration-issues">{inspection.issues.map(issue => <li key={issue.id}><Icon name={issue.severity === 'blocking' ? 'alert' : 'help-circle'} size={14} /><div><strong>{issue.severity === 'blocking' ? '需处理' : '请复核'}</strong><p>{issue.message}</p></div></li>)}</ul>}
    <section className="qd-integration-check-group"><div className="qd-integration-ai-heading"><h4>AI 交叉复核</h4><button type="button" className="qd-link" disabled={busy || dirty || requesting || ai.status === 'running'} onClick={() => void checkAI()}>{requesting || ai.status === 'running' ? '复核中…' : '检查语义冲突'}</button></div>{ai.status === 'ready' && ai.review ? <><p>{ai.review.overview}</p>{ai.review.findings.map(finding => <details key={finding.id}><summary>{finding.severity === 'conflict' ? '需核对' : '提醒'} · {finding.title}</summary><p>{finding.detail}</p></details>)}</> : <p>{ai.status === 'stale' ? '草稿有更新，请重新复核。' : ai.status === 'failed' ? 'AI 复核未完成，可继续人工核对。' : ai.status === 'running' ? '使用配置列表第一项分析已保存草稿。' : '结构校验不能识别所有文字矛盾。'}</p>}{ai.message && <details><summary>复核详情</summary><p>{ai.message}</p></details>}</section>
    <section className="qd-integration-check-group qd-integration-publish"><h4>确认发布</h4><label><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />我已核对来源、时间安排及各任务结论的兼容性</label><label>核对说明<textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="说明如何处理冲突与提醒" /></label><button type="button" className="qd-btn primary" disabled={busy || dirty || !reviewed || !note.trim() || !inspection.canPublish} onClick={() => void onPublish(note)}>发布 v{inspection.bundle.version + 1}<Icon name="arrow-right" size={14} /></button>{dirty && <small>先保存修改，再复核发布。</small>}</section>
  </aside>;
}
