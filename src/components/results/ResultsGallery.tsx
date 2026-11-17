import { useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import { ResultsIntegration } from './ResultsIntegration';
import { TaskMemoryLookup } from './TaskMemoryLookup';
import { DeliveryMap } from './DeliveryMap';
import './results-gallery.css';
import './results-focus.css';
import './delivery-map.css';

export function ResultsGallery({ onNew: _onNew }: { onNew?: () => void }) {
  const { snap } = useWorkdeck();
  const [history, setHistory] = useState(false);
  const hasHistory = !!(snap.integration?.versions.length || snap.integration?.revisions.length);
  return <main className="qd-gallery qd-results-library qd-map-page" aria-labelledby="gallery-title"><div className="qd-gallery-inner">
    <header className="qd-gallery-head"><div><p>{snap.project.name}</p><h1 id="gallery-title">项目成果地图</h1></div><details className="qd-result-search"><summary><Icon name="search" size={15} />查找历史</summary><TaskMemoryLookup key={snap.project.id} /></details></header>
    {hasHistory && <nav className="qd-results-sections" aria-label="成果内容"><button type="button" aria-pressed={!history} onClick={() => setHistory(false)}>当前交付地图</button><button type="button" aria-pressed={history} onClick={() => setHistory(true)}>完整成果 · 历史</button></nav>}
    {history && hasHistory ? <ResultsIntegration key={snap.project.id} /> : <DeliveryMap key={snap.project.id} />}
  </div></main>;
}
