import { DeleteWorkButton } from './DeleteWorkButton';
import { useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import './projects.css';

export function ProjectSwitcher({ onCreate, onEdit }: { onCreate: () => void; onEdit: (id: string) => void }) {
  const { snap, projectSnapshots, switchProject } = useWorkdeck();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return <div className="qd-project-picker">
    <button type="button" className="qd-project-trigger" aria-label={`切换项目：${snap.project.name || '尚无项目'}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="qd-project-color" style={{ background: snap.project.color || '#a74835' }} /><span>{snap.project.name || '新建项目'}</span><Icon name="chevron-down" size={13} />
    </button>
    <Popover open={open} onClose={() => setOpen(false)} align="left" label="项目列表" className="qd-project-picker-menu">
      <header><strong>我的项目</strong><span>{projectSnapshots.length}</span></header>
      <div className="qd-project-picker-list">{projectSnapshots.map(project => <div className="qd-project-picker-row" key={project.project.id}><button type="button" aria-pressed={project.project.id === snap.project.id} disabled={busy} onClick={async () => { setBusy(true); if (await switchProject(project.project.id)) setOpen(false); setBusy(false); }}>
        <span className="qd-project-color" style={{ background: project.project.color || '#a74835' }} /><span><strong>{project.project.name}</strong><small>{Object.keys(project.tasks).length} 个任务</small></span>{project.project.id === snap.project.id && <Icon name="check" size={15} />}
      </button><DeleteWorkButton projectId={project.project.id} title={project.project.name} /></div>)}</div>
      <footer><button type="button" onClick={() => { setOpen(false); onCreate(); }}><Icon name="plus" size={15} />新建项目</button>{snap.project.id && <button type="button" onClick={() => { setOpen(false); onEdit(snap.project.id); }}><Icon name="pencil" size={14} />项目设置</button>}</footer>
    </Popover>
  </div>;
}
