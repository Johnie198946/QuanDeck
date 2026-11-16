import { useId, useRef, useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { usePreferences } from '../../state/preferences';
import { AgentConnectionSetup } from '../deck/AgentConnectionSetup';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { useConfiguredAgents, removeConfiguredAgent, type ConfiguredAgent } from '../../integration/configuredAgents';
import { gateway, saveGatewaySettings, saveTestedConnection } from '../../integration/gateway';
import { TOOL_LABELS } from '../../integration/contracts';
import './settings.css';
import { desktopHost } from '../../integration/desktop';

const sections: { id: string; label: string; icon: IconName }[] = [
  { id: 'profile', label: '个人资料', icon: 'user' },
  { id: 'agents', label: '本地 Agent', icon: 'box' },
  { id: 'appearance', label: '显示', icon: 'sliders' },
  { id: 'data', label: '数据', icon: 'folder' },
];

export function SettingsPage({ embedded = false }: { embedded?: boolean }) {
  const { snap, api } = useWorkdeck();
  const { agents, configured } = useConfiguredAgents(snap.agents);
  const { preferences, update } = usePreferences();
  const [section, setSection] = useState('profile');
  const [connecting, setConnecting] = useState(false);
  const [name, setName] = useState(preferences.name);
  const [message, setMessage] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<Record<string,string>>({});
  const testingConnections = useRef(new Set<string>());
  const [backupBusy, setBackupBusy] = useState(false);
  const tabs = useRef<HTMLDivElement>(null);
  const connectButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = sections.find(item => item.id === section)!;

  async function testConnection(config: ConfiguredAgent) {
    if (testingConnections.current.has(config.id)) return;
    testingConnections.current.add(config.id);
    setConnectionStatus(current => ({...current,[config.id]:'正在检测…'}));
    try {
      const host=desktopHost();
      if (host) saveGatewaySettings(await host.getConnection());
      const receipt=await gateway.testConnection(config);
      if (receipt.status !== 'ready' || !receipt.connectionId) throw new Error('未连通，请检查 Agent 的登录和配置');
      const probe=await gateway.probeConnection({connectionId:receipt.connectionId,tool:receipt.tool,requestId:crypto.randomUUID()});
      if (probe.status !== 'connected') throw new Error(probe.message);
      // Re-testing never changes an existing project binding or resurrects a removed preference.
      if (receipt.connectionId === config.connectionId) saveTestedConnection(receipt);
      setConnectionStatus(current=>({...current,[config.id]:'已连通'}));
    } catch (error) {
      setConnectionStatus(current=>({...current,[config.id]:error instanceof Error && error.message.startsWith('未连通') ? error.message : '未连通，请检查 Agent 的登录和配置后重试'}));
    } finally {testingConnections.current.delete(config.id);}
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
      <small className="qd-settings-version">QuanDeck 0.6.2</small>
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
        <div className="qd-setting-row qd-setting-intro"><div><strong>连接你的工具</strong><p>安装教程、项目目录与连接检测</p></div><button ref={connectButton} className="qd-btn primary" onClick={() => setConnecting(true)}><Icon name="plus" size={15} />配置 Agent</button></div>
        {configured.length === 0 ? <div className="qd-settings-empty"><Icon name="box" size={28} /><p>还没有配置 Agent</p><span>添加后即可从任务发起讨论与委派。</span></div> : <div className="qd-configured-list">{configured.map(config => <div className="qd-setting-row qd-config-row" key={config.id}><div><strong>{TOOL_LABELS[config.tool]}</strong><p>{config.projectPath}</p><span role="status">{connectionStatus[config.id]}</span></div><button type="button" className="qd-btn ghost" disabled={connectionStatus[config.id] === '正在检测…'} onClick={() => void testConnection(config)}>{connectionStatus[config.id] === '正在检测…' ? '检测中…' : '测试连接'}</button><button className="qd-link" disabled={connectionStatus[config.id] === '正在检测…'} aria-label={`移除 ${TOOL_LABELS[config.tool]} 的 ${config.projectPath} 配置`} onClick={() => { void removeConfiguredAgent(config.id).then(() => setMessage('已移除配置，历史任务保留')).catch(error => setMessage(error instanceof Error ? error.message : '移除失败，请重试')); }}>移除</button></div>)}</div>}
        {agents.length > 0 && <label className="qd-setting-row"><span>默认 Agent</span><select aria-label="默认 Agent" value={agents.some(agent => agent.id === snap.defaultAgent) ? snap.defaultAgent : agents[0].id} onChange={event => { void api.setDefaultAgent(event.target.value).then(() => setMessage('默认 Agent 已更新')).catch(() => setMessage('未能更新默认 Agent，请重试')); }}>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>}
        <p className="qd-setting-feedback" role="status">{message}</p>
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
    {connecting && <AgentConnectionSetup onClose={() => { setConnecting(false); requestAnimationFrame(() => connectButton.current?.focus()); }} />}
  </div>;
}
