import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import { TaskOutputButton } from '../outputs/OutputDialog';
import { DeliveryMap } from './DeliveryMap';
import './results.css';
import './results-focus.css';
import './delivery-map.css';

/** The same ledger map, narrowed to the chosen task branch. No execution interstitial. */
export function ResultsBoard() {
  const { snap, workspace, closeWorkspace } = useWorkdeck();
  if (!workspace) return null;
  const task = snap.tasks[workspace.taskId];
  const itemId = workspace.selected ?? workspace.itemId ?? undefined;
  const item = itemId ? snap.orchestrations?.[workspace.taskId]?.items[itemId] : undefined;
  return <section className="qd-results qd-focused-results" aria-label="任务成果汇总">
    <header className="qd-focused-head"><button type="button" className="qd-ws-back" onClick={closeWorkspace}><Icon name="chevron-left" size={16} />返回</button><div><p>{item ? `${task?.title ?? '任务'} / 子任务成果` : '任务成果地图'}</p><h1>{item?.title ?? task?.title ?? '任务已归档'}</h1></div><button type="button" className="qd-link" onClick={() => window.dispatchEvent(new CustomEvent('quandeck:show-results'))}>项目成果地图<Icon name="arrow-right" size={14} /></button>{task && <TaskOutputButton taskId={task.id} itemId={item?.id} />}</header>
    <div className="qd-map-task-content"><DeliveryMap key={`${snap.project.id}:${workspace.taskId}:${itemId ?? ''}`} scope={{ taskId: workspace.taskId, workItemId: itemId }} /></div>
  </section>;
}
