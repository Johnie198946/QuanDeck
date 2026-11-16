import { useState } from 'react';
import type { ToolId } from '../../integration/contracts';
import { CONNECTION_STAGE_LABELS, connectionDiagnosticReport, type ConnectionDiagnosis, type ConnectionStage } from '../../integration/connectionDiagnostics';

export function ConnectionDiagnostic({ stage, diagnosis, tool, version, busy }: { stage: ConnectionStage | 'done' | null; diagnosis: ConnectionDiagnosis | null; tool: ToolId; version?: string | null; busy: boolean }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  if (!stage && !diagnosis) return null;
  const report = diagnosis ? connectionDiagnosticReport(tool, diagnosis, version) : '';
  return <div className="qd-connection-diagnostic">
    {stage && stage !== 'host' && <ol className="qd-connection-stages" aria-label="连接检测进度" aria-live="polite">
      {(tool === 'workbuddy' ? ['handshake'] as const : ['handshake', 'reply'] as const).map((item, index) => {
        const passed = stage === 'done' || item === 'handshake' && stage === 'reply';
        const failed = diagnosis?.stage === item;
        return <li key={item} data-state={failed ? 'failed' : passed ? 'passed' : stage === item && busy ? 'active' : 'pending'}><span>{index + 1}</span><div>{tool === 'workbuddy' ? '检查 WorkBuddy 与项目' : CONNECTION_STAGE_LABELS[item]}<small>{failed ? '未通过' : passed ? '已通过' : stage === item && busy ? '检测中…' : '等待上一项'}</small></div></li>;
      })}
    </ol>}
    {diagnosis && <div role="alert" className="qd-connection-diagnosis"><strong>{diagnosis.title}</strong><p>{diagnosis.next}</p><details><summary>诊断摘要 · {diagnosis.code}</summary><pre>{report}</pre><button type="button" className="qd-btn small" onClick={async () => { try { await navigator.clipboard.writeText(report); setCopied(true); setCopyFailed(false); } catch { setCopyFailed(true); } }}>{copyFailed ? '请选中上方文字复制' : copied ? '已复制' : '复制诊断摘要'}</button><small>仅包含工具、版本和失败阶段，不含密钥或配置正文。</small></details></div>}
  </div>;
}
