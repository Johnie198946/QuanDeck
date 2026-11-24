import { useEffect, useId, useState } from 'react';
import { desktopHost, type CodexApprovalMode } from '../../integration/desktop';

const descriptions: Record<CodexApprovalMode, string> = {
  manual: 'Codex 在工具需要授权时询问你。',
  ai: 'Codex 逐项判断并决定是否放行。选择一次，后续任务沿用。',
  full: 'Codex 可读写当前系统账户可访问的文件、连接网络，无需逐项批准。',
};

export function CodexApprovalSetting() {
  const host = desktopHost();
  const id = useId();
  const [mode, setMode] = useState<CodexApprovalMode>();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    host?.getCodexApprovalMode?.().then(value => {
      if (active) setMode(value);
    }).catch(() => { if (active) setMessage('未能读取授权设置，请重新打开设置重试。'); });
    return () => { active = false; };
  }, [host]);

  async function save(next: CodexApprovalMode) {
    if (!host?.setCodexApprovalMode || saving) return;
    setSaving(true);
    try {
      await host.setCodexApprovalMode(next);
      setMode(next);
      setMessage('已保存，将从下一轮 Codex 任务生效。');
    } catch {
      setMessage('未能保存授权设置，请重试。');
    } finally {
      setSaving(false);
    }
  }

  if (!host?.setCodexApprovalMode) return null;
  return <fieldset className="qd-codex-approval" disabled={!mode || saving}>
    <legend>Codex 工具授权</legend>
    <p>适用于本机所有项目。新开的 Codex 任务和下一轮对话会沿用。</p>
    {(['manual', 'ai', 'full'] as const).map(value =>
      <label key={value}>
        <input type="radio" name={id} value={value} checked={mode === value} onChange={() => void save(value)} />
        <span><strong>{{manual: '人工逐次审批', ai: 'AI 决策', full: '完全放开'}[value]}</strong><small>{descriptions[value]}</small></span>
      </label>)}
    {message && <p className="qd-setting-feedback" role="status">{message}</p>}
  </fieldset>;
}
