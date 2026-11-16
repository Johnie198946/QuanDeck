import { useEffect, useId, useRef, useState } from 'react';
import type { ConnectionInput, DshModelInspection, DshModelSource } from '../../integration/contracts';
import { gateway } from '../../integration/gateway';
import { diagnoseConnection } from '../../integration/connectionDiagnostics';
import { Icon } from '../ui/Icon';
import './DshModelReuse.css';

const profileLabel = (profile: string) => ({ desktop: 'DSH 桌面', web: 'DSH 网页', sdk: 'DSH SDK' }[profile] ?? profile);
const signatureOf = (input: ConnectionInput) => JSON.stringify([input.tool, input.projectPath, input.binary, input.nodePath, input.provider, input.model, input.dshModelSource]);

/** Inspect without changing user settings; choosing a source requires explicit test-and-apply. */
export function DshModelReuse({ input, disabled = false, saved = false, prepare, onUse, hasPrevious = false, onRestore }: {
  input: ConnectionInput;
  disabled?: boolean;
  saved?: boolean;
  prepare?: () => Promise<void>;
  onUse: (source: DshModelSource) => Promise<boolean>;
  hasPrevious?: boolean;
  onRestore?: () => Promise<boolean>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [inspection, setInspection] = useState<DshModelInspection | null>(null);
  const [selected, setSelected] = useState('');
  const [action, setAction] = useState<'inspect' | 'use' | 'restore' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const signature = signatureOf(input);
  const latestSignature = useRef(signature);
  latestSignature.current = signature;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => { generation.current++; busy.current = false; setInspection(null); setSelected(''); setAction(null); setError(''); setNotice(''); }, [signature]);
  const begin = (kind: 'inspect' | 'use' | 'restore') => {
    if (busy.current || disabled || !mounted.current) return null;
    busy.current = true; const request = ++generation.current;
    setAction(kind); setError(''); setNotice('');
    return () => mounted.current && request === generation.current && signature === latestSignature.current;
  };
  const finish = (current: () => boolean) => { if (current()) { busy.current = false; setAction(null); } };
  const inspect = async () => {
    const current = begin('inspect'); if (!current) return;
    setOpen(true); setInspection(null); setSelected('');
    try {
      await prepare?.(); if (!current()) return;
      const result = await gateway.inspectDshModels({ tool: 'dsh', projectPath: input.projectPath, binary: input.binary, nodePath: input.nodePath }); if (!current()) return;
      setInspection(result);
      const available = result.candidates.filter(candidate => candidate.status === 'available');
      if (available.length === 1) setSelected(JSON.stringify([available[0].profile, available[0].revision]));
    } catch (cause) {
      if (current()) { const diagnosis = diagnoseConnection('handshake', cause, 'dsh'); setError(`${diagnosis.title}。${diagnosis.next}`); }
    } finally { finish(current); }
  };
  const use = async () => {
    const candidate = inspection?.candidates.find(candidate => candidate.status === 'available' && JSON.stringify([candidate.profile, candidate.revision]) === selected);
    if (!candidate) return;
    const current = begin('use'); if (!current) return;
    try {
      const success = await onUse({ profile: candidate.profile, revision: candidate.revision });
      if (current()) { if (success) setNotice(saved ? '已使用此模型，原连接可撤销恢复。' : '模型检测通过，请点击“保存配置”。'); else setError('本次操作未完成，请查看连接诊断。源配置有变化时重新读取；保存异常时重新打开 QuanDeck 核对当前连接。'); }
    } catch { if (current()) setError('未能完成模型配置更新，请重新打开设置核对当前连接后重试。'); }
    finally { finish(current); }
  };
  const restore = async () => {
    const current = begin('restore'); if (!current || !onRestore) return;
    try { if (await onRestore() && current()) { setInspection(null); setSelected(''); setNotice('已恢复原连接，请重新测试连接。'); } }
    catch { if (current()) setError('未能完成恢复，请重新打开设置核对当前连接。'); }
    finally { finish(current); }
  };
  const unavailable = disabled || action !== null;
  return <section className="qd-dsh-model-reuse" aria-labelledby={`${id}-heading`}>
    <div className="qd-dsh-reuse-entry"><button type="button" id={`${id}-heading`} className="qd-text-btn" aria-expanded={open} aria-controls={`${id}-body`} disabled={unavailable} onClick={() => open ? setOpen(false) : void inspect()}><Icon name="sliders" size={15}/>{action === 'inspect' ? '正在读取模型配置…' : '使用已有模型配置'}<Icon name={open ? 'chevron-down' : 'chevron-right'} size={13}/></button>{hasPrevious && onRestore && <button type="button" className="qd-link qd-dsh-restore" disabled={unavailable} onClick={() => void restore()}>{action === 'restore' ? '正在恢复…' : '撤销模型复用'}</button>}</div>
    {input.dshModelSource && <p className="qd-dsh-current-source">此连接使用 {profileLabel(input.dshModelSource.profile)} 的模型配置。</p>}
    {open && <div id={`${id}-body`} className="qd-dsh-reuse-body">
      <p>读取 DSH 已有模型，不需要填写密钥。选择只用于此连接，保留源工具设置。</p>
      {!inspection && !action && !error && <button type="button" className="qd-text-btn" disabled={disabled} onClick={() => void inspect()}>读取当前模型配置</button>}
      {action === 'inspect' && <p role="status">正在查找可复用的模型…</p>}
      {inspection && <>
        <p className="qd-dsh-sdk-status">{inspection.sdk.status === 'configured' ? <>当前 SDK：<strong>{inspection.sdk.model || '已有默认模型'}</strong>{inspection.sdk.provider && <span> · {inspection.sdk.provider}</span>}</> : <>尚不能确认 SDK 模型路由。{inspection.sdk.model && <strong>{inspection.sdk.model}</strong>}{inspection.sdk.provider && <span> · {inspection.sdk.provider}</span>}</>}</p>
        {inspection.candidates.length > 0 ? <fieldset className="qd-dsh-source-list"><legend>选择已有配置</legend>{inspection.candidates.map(candidate => {
          const key = JSON.stringify([candidate.profile, candidate.revision]);
          const available = candidate.status === 'available';
          return <label key={key} className={`qd-dsh-source${!available ? ' is-unavailable' : ''}`}><input type="radio" name={`${id}-source`} value={key} checked={selected === key} disabled={!available || unavailable} onChange={() => { setSelected(key); setNotice(''); }}/><span><strong>{profileLabel(candidate.profile)}</strong><span>{candidate.model || '未找到可用模型'}{candidate.provider && <> · {candidate.provider}</>}</span>{!available && <small>{candidate.reason || '此配置暂不能用于当前连接。'}</small>}</span></label>;
        })}</fieldset> : <p className="qd-dsh-reuse-empty" role="status">没有找到可复用的模型。先在 DSH 桌面或网页中配置并保存模型，再重新读取。</p>}
        {inspection.message && <p>{inspection.message}</p>}
        <div className="qd-dsh-reuse-actions"><button type="button" className="qd-btn primary small" disabled={unavailable || !selected} onClick={() => void use()}>{action === 'use' ? '正在检测模型…' : '使用此模型并检测'}</button><button type="button" className="qd-text-btn" disabled={unavailable} onClick={() => void inspect()}>重新读取</button></div>
        <p className="qd-dsh-reuse-hint">检测包含一次简短模型回复，可能使用源工具额度。{saved ? '通过后才更新此连接；失败保留原配置。' : '通过后可保存为此项目的连接。'}</p>
      </>}
      {error && <div role="alert" className="qd-dsh-reuse-error"><p>{error}</p><button type="button" className="qd-text-btn" disabled={unavailable} onClick={() => void inspect()}>重新读取</button></div>}
    </div>}
    {notice && <p className="qd-dsh-reuse-notice" role="status">{notice}</p>}
  </section>;
}
