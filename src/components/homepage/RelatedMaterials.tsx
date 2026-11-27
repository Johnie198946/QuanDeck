import { MaterialFiles, UseMaterial } from './MaterialActions';
import type {MaterialTarget} from '../../data/materialUse';
import type { MaterialMatch } from '../../data/materialRecall';
import { Icon } from '../ui/Icon';

interface Props {
  materials: MaterialMatch[];
  target?:MaterialTarget;
  onOpenNote: (noteId: string, todoId: string) => void;
}

export function RelatedMaterials({ materials, target, onOpenNote }: Props) {
  if (!materials.length) return null;
  return <details className="qh-materials">
    <summary>
      <Icon name="attachment" size={14}/>
      <b>可用材料</b>
      <span className="qh-material-title">{materials[0].text || materials[0].files?.[0]?.name || materials[0].title}</span>
      {materials.length > 1 && <small>{materials.length} 份</small>}
      <Icon name="chevron-down" size={13}/>
    </summary>
    <ul>{materials.map(material =>
      <li key={JSON.stringify([material.noteId, material.todoId])}>
        <p>{material.text || material.files?.[0]?.name || material.title}</p>
        <div className="qh-material-origin">
          <span>{material.purpose ? '用途 · ' + material.purpose : material.reason}</span>
          <button type="button" onClick={() => onOpenNote(material.noteId, material.todoId)}>
            来源 · {material.title} <Icon name="arrow-right" size={12}/>
          </button>
          {material.url && <a href={material.url} target="_blank" rel="noreferrer">
            打开材料 <Icon name="external" size={12}/>
          </a>}
          {target && <UseMaterial match={material} target={target}/>}
        </div>
        <MaterialFiles files={material.files} noteId={material.noteId}/>
      </li>
    )}</ul>
  </details>;
}
