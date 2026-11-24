import { useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import { AgentConnectionSetup } from './AgentConnectionSetup';
import { AgentTargets } from './AgentTargets';
import './agent-dock.css';

import type { ProjectActivityEntry } from '../../data/projectActivity';

export function AgentRoster({ entries }: { entries: ProjectActivityEntry[] }) {
  const { setRailPanel } = useWorkdeck();
  const [connecting, setConnecting] = useState(false);
  return <section className="qd-agent-dock" aria-label="Agent 执行伙伴">
    {connecting && <AgentConnectionSetup onClose={() => setConnecting(false)}/>}
    <header><h2>Agents</h2><div><button type="button" className="qd-icon-btn" onClick={() => setConnecting(true)} aria-label="连接 Agent" title="连接 Agent"><Icon name="plus" size={16}/></button><button type="button" className="qd-link" onClick={() => setRailPanel('agents')}>管理</button></div></header>
    <AgentTargets entries={entries}/>
  </section>;
}
