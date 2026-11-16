import { useEffect, useId, useRef, useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { usePreferences } from '../../state/preferences';
import { AgentConnectionSetup } from '../deck/AgentConnectionSetup';
import { ConnectionDiagnostic } from '../deck/ConnectionDiagnostic';
import { DshModelReuse } from '../deck/DshModelReuse';
import { CopyCommand } from '../deck/AgentSetupGuide';
import { diagnoseConnection, type ConnectionDiagnosis, type ConnectionStage } from '../../integration/connectionDiagnostics';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { useConfiguredAgents, getConfiguredAgents, removeConfiguredAgent, replaceConfiguredAgentConnection, restoreConfiguredAgentConnection, type ConfiguredAgent } from '../../integration/configuredAgents';
import { gateway, saveGatewaySettings, saveTestedConnection } from '../../integration/gateway';
import { TOOL_LABELS, type ConnectionInput, type DshModelSource } from '../../integration/contracts';
import './settings.css';
import { desktopHost } from '../../integration/desktop';

const sections: { id: string; label: string; icon: IconName }[] = [
  { id: 'profile', label: '个人资料', icon: 'user' },
  { id: 'agents', label: '本地 Agent', icon: 'box' },
  { id: 'notifications', label: '提醒', icon: 'alert' },
  { id: 'appearance', label: '显示', icon: 'sliders' },
  { id: 'data', label: '数据', icon: 'folder' },
];

interface ConnectionRetest {
  signature: string; request: number; busy: boolean; operation?: 'restore';
  stage: ConnectionStage | 'done'; diagnosis: ConnectionDiagnosis | null;
  version: string | null; notice: string;
}
const connectionSignature = (config: ConfiguredAgent) => JSON.stringify([config.id, config.tool, config.agentId, config.displayName, config.projectPath, config.binary, config.nodePath, config.provider, config.model, config.connectionId, config.dshModelSource, config.previousConnection]);

export function SettingsPage({ embedded = false }: { embedded?: boolean }) {
  const { snap, api } = useWorkdeck();
  const { agents, configured } = useConfiguredAgents(snap.agents);
  const { preferences, update } = usePreferences();
  const [section, setSection] = useState('profile');
  const [connecting, setConnecting] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ConfiguredAgent | undefined>();
  const [name, setName] = useState(preferences.name);
  const [message, setMessage] = useState('');
  const [connectionChecks, setConnectionChecks] = useState<Record<string, ConnectionRetest>>({});
  const testingConnections = useRef(new Map<string, { request: number; signature: string }>());
  const nextConnectionRequest = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; testingConnections.current.clear(); }; }, []);
  const [backupBusy, setBackupBusy] = useState(false);
  const tabs = useRef<HTMLDivElement>(null);
  const connectButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = sections.find(item => item.id === section)!;

  async function testConnection(config: ConfiguredAgent, source?: DshModelSource): Promise<boolean> {
    const signature = connectionSignature(config);
    if (!mounted.current || testingConnections.current.get(config.id)?.signature === signature) return false;
    const request = ++nextConnectionRequest.current;
    testingConnections.current.set(config.id, { request, signature });
    const current = () => mounted.current && testingConnections.current.get(config.id)?.request === request && getConfiguredAgents().some(saved => saved.id === config.id && connectionSignature(saved) === signature);
    if (!current()) { testingConnections.current.delete(config.id); return false; }
    let stage: ConnectionStage = desktopHost() ? 'host' : 'handshake';
    setConnectionChecks(previous => ({ ...previous, [config.id]: { signature, request, busy: true, stage, diagnosis: null, version: null, notice: '' } }));
    const updateCheck = (patch: Partial<ConnectionRetest>) => {
      if (current()) setConnectionChecks(previous => ({ ...previous, [config.id]: { ...previous[config.id], ...patch } }));
    };
    try {
      const host = desktopHost();
      if (host) {
        const settings = await host.getConnection();
        if (!current()) return false;
        saveGatewaySettings(settings);
      }
      stage = 'handshake'; updateCheck({ stage });
      const input: ConnectionInput = {tool:config.tool,projectPath:config.projectPath,binary:config.binary,nodePath:config.nodePath,agentId:config.agentId,displayName:config.displayName,
        ...(source ? {dshModelSource:source} : {provider:config.provider,model:config.model,dshModelSource:config.dshModelSource})};
      const receipt = await gateway.testConnection(input);
      if (!current()) return false;
      updateCheck({ version: receipt.desktopVersion ?? receipt.cliVersion ?? null });
      if (!(receipt.status === 'ready' || config.tool === 'workbuddy' && receipt.discussionOpen) || !receipt.connectionId) throw new Error(receipt.status === 'needs_login' ? 'needs_login' : receipt.note || 'unsupported');
      if (config.tool === 'dsh') {
        stage = 'reply'; updateCheck({ stage });
        const probe = await gateway.probeConnection({ connectionId: receipt.connectionId, tool: receipt.tool, requestId: crypto.randomUUID() });
        if (!current()) return false;
        if (probe.status !== 'connected') throw new Error(probe.message);
      }
      if (source) {
        const replacement = await replaceConfiguredAgentConnection(api, config, receipt);
        if (mounted.current && testingConnections.current.get(config.id)?.request === request && getConfiguredAgents().some(saved => saved.id === config.id && connectionSignature(saved) === connectionSignature(replacement))) {
          setConnectionChecks(previous => ({...previous,[config.id]:{signature:connectionSignature(replacement),request,busy:false,stage:'done',diagnosis:null,version:receipt.cliVersion??null,notice:'已使用选定模型，连接已更新。'}}));
        }
        return true;
      }
      // Only the exact still-saved configuration can receive a verified test receipt.
      if (receipt.connectionId === config.connectionId) saveTestedConnection(receipt);
      const status = config.tool === 'workbuddy' ? `可打开客户端讨论${receipt.desktopVersion ? ' · ' + receipt.desktopVersion : ''}` : config.tool === 'dsh' ? '已连通' : config.tool === 'codex' ? '本机握手通过。请在连接设置中试发消息，验证模型回复' : '连接已验证';
      updateCheck({ stage: 'done', busy: false, notice: receipt.connectionId === config.connectionId ? status : status + '。连接参数已变化，请重新配置后保存。' });
      return true;
    } catch (error) {
      const diagnosis = diagnoseConnection(stage, error, config.tool);
      updateCheck({ stage: diagnosis.stage, diagnosis, busy: false });
      return false;
    } finally {
      if (testingConnections.current.get(config.id)?.request === request) {
        updateCheck({ busy: false });
        testingConnections.current.delete(config.id);
      }
    }
  }


  async function restoreConnection(config: ConfiguredAgent): Promise<boolean> {
    const signature = connectionSignature(config);
    if (!mounted.current || testingConnections.current.has(config.id) || !config.previousConnection) return false;
    const request = ++nextConnectionRequest.current;
    testingConnections.current.set(config.id, {request,signature});
    const current = () => mounted.current && testingConnections.current.get(config.id)?.request === request && getConfiguredAgents().some(saved => saved.id === config.id && connectionSignature(saved) === signature);
    setConnectionChecks(previous => ({...previous,[config.id]:{signature,request,busy:true,operation:'restore',stage:'handshake',diagnosis:null,version:null,notice:''}}));
    try {
      if (!current()) return false;
      const restored = await restoreConfiguredAgentConnection(api, config);
      if (mounted.current && testingConnections.current.get(config.id)?.request === request && getConfiguredAgents().some(saved => saved.id === restored.id && connectionSignature(saved) === connectionSignature(restored))) {
        setConnectionChecks(previous => { const next={...previous}; delete next[config.id]; return next; });
        setMessage('已恢复原连接，请重新测试连接。历史任务保留。');
      }
      return true;
    } catch {
      if (current()) setMessage('未能恢复原连接，当前配置保持不变，请重试。');
      return false;
    } finally {
      if (testingConnections.current.get(config.id)?.request === request) {
        if (current()) setConnectionChecks(previous => ({...previous,[config.id]:{...previous[config.id],busy:false}}));
        testingConnections.current.delete(config.id);
      }
    }
  }

  async function exportData() {
    try {
    const projectSnapshots = await api.listProjects();
    const blob = new Blob([JSON.stringify({ format: "quandeck-projects-v1", exportedAt: new Date().toISOString(), projects: projectSnapshots }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `QuanDeck-${snap.date}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('全部项目已导出');
    } catch (error) { setMessage(error instanceof Error ? error.message : '导出失败，请重试'); }
  }

  async function backupWorkspace() {
    const host = desktopHost();
    if (!host || backupBusy) return;
    setBackupBusy(true); setMessage('');
    try {
      const result = await host.backupWorkspace();
      if (result) setMessage(`工作区备份已保存：${result.directory}（${result.files} 个文件及校验清单）`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '备份失败，请重试'); }
    finally { setBackupBusy(false); }
  }

  return <div className={`qd-settings ${embedded ? 'is-embedded' : ''}`}>
    {!embedded && <h1 className="qd-settings-page-title">我的设置</h1>}
    <aside className="qd-settings-sidebar">
      <div className="qd-settings-identity"><span className="qd-profile-initial" aria-hidden="true">{preferences.name.slice(0, 1)}</span><div><strong>{preferences.name}</strong><small>本机用户</small></div></div>
      <div className="qd-settings-tabs" ref={tabs} role="tablist" aria-label="设置分类" onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = sections.findIndex(item => item.id === section);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : (index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + sections.length) % sections.length;
        setSection(sections[next].id); setMessage('');
        tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}>
        {sections.map(item => <button type="button" role="tab" key={item.id} id={`${id}-${item.id}-tab`} aria-selected={section === item.id} aria-controls={`${id}-${item.id}-panel`} tabIndex={section === item.id ? 0 : -1} className={section === item.id ? 'is-active' : ''} onClick={() => { setSection(item.id); setMessage(''); }}><Icon name={item.icon} size={17} /><span>{item.label}</span></button>)}
      </div>
      <small className="qd-settings-version">QuanDeck 0.7.6</small>
    </aside>
    <section className="qd-settings-panel" role="tabpanel" tabIndex={0} id={`${id}-${section}-panel`} aria-labelledby={`${id}-${section}-tab`}>
      <h2>{current.label}</h2>
      {section === 'profile' && <>
        <div className="qd-profile-preview"><span className="qd-profile-initial" aria-hidden="true">{preferences.name.slice(0, 1)}</span><div><strong>{preferences.name}</strong><p>你的 QuanDeck 工作台</p></div></div>
        <form className="qd-profile-form" onSubmit={event => {
          event.preventDefault();
          if (name.trim()) { update({ name: name.trim() }); setName(name.trim()); setMessage('名称已保存'); }
        }}>
          <label htmlFor={`${id}-profile-name`}>显示名称</label>
          <input id={`${id}-profile-name`} maxLength={40} value={name} onChange={event => { setName(event.target.value); setMessage(''); }} required />
          <div className="qd-settings-form-actions"><button className="qd-btn primary" type="submit" disabled={!name.trim() || name.trim() === preferences.name}>保存</button><span role="status">{message}</span></div>
        </form>
      </>}
      {section === 'agents' && <>
        <div className="qd-setting-row qd-setting-intro"><div><strong>连接你的工具</strong><p>安装教程、项目目录与连接检测</p></div><button ref={connectButton} className="qd-btn primary" onClick={() => { setEditingConfig(undefined); setConnecting(true); }}><Icon name="plus" size={15} />配置 Agent</button></div>
        {configured.length === 0 ? <div className="qd-settings-empty"><Icon name="box" size={28} /><p>还没有配置 Agent</p><span>添加后即可从任务发起讨论与委派。</span></div> : <div className="qd-configured-list">{configured.map(config => {
          const savedCheck = connectionChecks[config.id];
          const check = savedCheck?.signature === connectionSignature(config) ? savedCheck : undefined;
          return <div className="qd-config-entry" key={config.id}>
            <div className="qd-setting-row qd-config-row"><div><strong>{config.displayName || TOOL_LABELS[config.tool]}</strong><p>{config.projectPath}</p><span role="status">{check?.busy ? check.operation === 'restore' ? '正在恢复原连接…' : check.stage === 'host' ? '正在连接本机服务…' : '正在检测…' : check?.notice}</span></div><button type="button" className="qd-btn ghost" disabled={check?.busy} onClick={() => void testConnection(config)}>{check?.busy ? check.operation === 'restore' ? '恢复中…' : '检测中…' : '测试连接'}</button><button className="qd-link" disabled={check?.busy} onClick={() => { setEditingConfig(config); setConnecting(true); }}>检查与设置</button><button className="qd-link" disabled={check?.busy} aria-label={`移除 ${config.displayName || TOOL_LABELS[config.tool]} 的 ${config.projectPath} 配置`} onClick={() => { void removeConfiguredAgent(config.id).then(() => { if (mounted.current) setMessage('已移除配置，历史任务保留'); }).catch(() => { if (mounted.current) setMessage('移除失败，请重试'); }); }}>移除</button></div>
            {check && (config.tool === 'dsh' || check.diagnosis) && check.operation !== 'restore' && <ConnectionDiagnostic key={`${config.id}:${check.request}`} stage={check.stage} diagnosis={check.diagnosis} tool={config.tool} version={check.version} busy={check.busy} />}
            {config.tool === 'dsh' && <DshModelReuse key={connectionSignature(config)} input={config} saved disabled={check?.busy} prepare={async () => { const host=desktopHost(); if(host)saveGatewaySettings(await host.getConnection()); }} onUse={source=>testConnection(config,source)} hasPrevious={!!config.previousConnection} onRestore={()=>restoreConnection(config)}/>}
            {config.tool === 'dsh' && <details className="qd-saved-dsh-help"><summary>Windows：DSH 连接检查</summary><p>在 DSH 菜单选择 Manage dsh Command… → Install / Repair，然后新开 PowerShell：</p><CopyCommand command="where.exe dsh" /><CopyCommand command="dsh --version" /><CopyCommand command="Get-Command dsh -All | Select-Object CommandType, Source" /><p>CLI 选择当前 Desktop 安装目录的 dsh.cmd，Node.js 路径留空，再选择实际工作文件夹。修改配置请使用上方“配置 Agent”。</p><p>检测会先启动 SDK，再等待约 60 秒确认模型回复。QuanDeck 读取 sdk 配置；桌面或网页能聊天，不保证 sdk 有相同模型路由。</p><p>无需填写 API Key 或 DSH 网页地址。排查时只提供路径、版本和诊断摘要，不要粘贴完整配置文件。</p></details>}
          </div>;
        })}</div>}
        {agents.length > 0 && <label className="qd-setting-row"><span>默认 Agent</span><select aria-label="默认 Agent" value={agents.some(agent => agent.id === snap.defaultAgent) ? snap.defaultAgent : agents[0].id} onChange={event => { void api.setDefaultAgent(event.target.value).then(() => setMessage('默认 Agent 已更新')).catch(() => setMessage('未能更新默认 Agent，请重试')); }}>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>}
        <p className="qd-setting-feedback" role="status">{message}</p>
      </>}
      {section === 'notifications' && <>
        <label className="qd-setting-row"><div><strong>桌面提醒</strong><p>需要回复、授权或处理异常时通知我</p></div><input type="checkbox" role="switch" aria-label="桌面提醒" checked={preferences.notifications} onChange={event => update({notifications:event.target.checked})}/></label>
        <div className="qd-setting-row"><div><strong>任务提醒始终保留</strong><p>右上角铃铛汇总异常与最后进展。同一提醒不重复弹出。</p></div></div>
        <div className="qd-setting-row"><div><strong>一段时间没有进展</strong><p>运行中连续 3 分钟没有新进展时提醒。等待你的回复或授权时不会误报。</p></div></div>
      </>}
      {section === 'appearance' && <>
        <label className="qd-setting-row"><div><strong>执行记录</strong><p>切换呈现内容，完整历史始终保留</p></div><select aria-label="执行记录密度" value={preferences.logDensity} onChange={event => update({logDensity:event.target.value as 'brief'|'standard'|'detailed'})}><option value="brief">简略</option><option value="standard">标准</option><option value="detailed">详细</option></select></label>
        <label className="qd-setting-row"><div><strong>紧凑布局</strong><p>在一屏内展示更多任务</p></div><input type="checkbox" role="switch" aria-label="紧凑布局" checked={preferences.compact} onChange={event => update({ compact: event.target.checked })} /></label>
        <label className="qd-setting-row"><div><strong>减少动态效果</strong><p>关闭过渡与动画</p></div><input type="checkbox" role="switch" aria-label="减少动态效果" checked={preferences.reduceMotion} onChange={event => update({ reduceMotion: event.target.checked })} /></label>
      </>}
      {section === 'data' && <>
        <div className="qd-setting-row"><div><strong>导出全部项目</strong><p>任务、方法、成果和日程；附件在成果中单独下载</p></div><button className="qd-btn ghost" onClick={exportData}>导出 JSON</button></div>
        {desktopHost() && <div className="qd-setting-row"><div><strong>备份整个工作区</strong><p>保存本地数据库、项目附件和文件校验清单</p></div><button type="button" className="qd-btn ghost" disabled={backupBusy} onClick={() => void backupWorkspace()}>{backupBusy ? '备份中…' : '选择备份位置'}</button></div>}
        {desktopHost() && <div className="qd-setting-row"><div><strong>清理旧安装包</strong><p>仅删除下载目录中旧版 QuanDeck 安装包</p></div><button className="qd-btn ghost" onClick={() => { void desktopHost()!.cleanInstallers().then(result => setMessage(`已清理 ${result.removed.length} 个安装包，释放 ${(result.freedBytes / 1024 / 1024).toFixed(1)} MB`)).catch(error => setMessage(error.message)); }}>清理</button></div>}
        <p role="status" className="qd-setting-feedback">{message}</p>
      </>}
    </section>
    {connecting && <AgentConnectionSetup initialConfig={editingConfig} onClose={() => { setConnecting(false); requestAnimationFrame(() => connectButton.current?.focus()); }} />}
  </div>;
}
