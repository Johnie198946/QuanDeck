import { useState } from 'react';
import type { TaskWorkspaceReceipt } from '../../data/runtimeContracts';
import type { Snapshot } from '../../data/types';
import { Icon } from '../ui/Icon';
import './task-workspace.css';

export function TaskWorkspace({workspace}: {workspace: TaskWorkspaceReceipt}) {
  const [notice, setNotice] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText([workspace.directory, workspace.branch, workspace.baseSha].join('\n'));
      setNotice('目录、分支和起始提交已复制');
    } catch { setNotice('请选中工作树信息后复制'); }
  };
  return <details className="qw-task-workspace"><summary>
    <Icon name="folder" size={15}/><strong>{workspace.role === 'release' ? '发布工作树' : '代码工作树'}</strong>
    <code>{workspace.branch}</code>
  </summary><dl>
    <div><dt>工作目录</dt><dd><code>{workspace.directory}</code></dd></div>
    <div><dt>分支</dt><dd><code>{workspace.branch}</code></dd></div>
    <div><dt>起始提交</dt><dd><code>{workspace.baseSha}</code></dd></div>
  </dl><button type="button" className="qp-btn" onClick={() => void copy()}>复制工作树信息</button>
  {notice && <span role="status">{notice}</span>}</details>;
}

export function TaskWorkspaces({snapshot, taskId, itemId}: {snapshot: Snapshot; taskId: string; itemId?: string}) {
  const workspaces = new Map<string,TaskWorkspaceReceipt>();
  for (const session of Object.values(snapshot.sessions)) {
    const meta = session.runtime;
    if (meta?.taskWorkspace && meta.projectId === snapshot.project.id && meta.taskId === taskId &&
        (meta.workItemId ?? null) === (itemId ?? null)) workspaces.set(meta.taskWorkspace.directory,meta.taskWorkspace);
  }
  return <>{[...workspaces.values()].map(workspace => <TaskWorkspace key={workspace.directory} workspace={workspace}/>)}</>;
}
