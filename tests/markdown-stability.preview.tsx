import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MarkdownMessage } from '../src/components/runtime/RichMessage';
import '../src/index.css';

function Fixture() {
  const [snapshot, setSnapshot] = useState({ tick: 0, run: 'run-a', file: 'guide-a.html', suffix: '' });
  useEffect(() => {
    const update = (event: Event) => setSnapshot(old => ({ ...old, ...(event as CustomEvent).detail, tick: old.tick + 1 }));
    window.addEventListener('preview-snapshot', update);
    return () => window.removeEventListener('preview-snapshot', update);
  }, []);
  return <main style={{ padding: 24, maxWidth: 900 }}>
    <h1>附件阅读稳定性</h1><output aria-label="快照版本">{snapshot.tick}</output>
    <MarkdownMessage runId={snapshot.run} text={`项目攻略：[图文攻略](${snapshot.file})。${snapshot.suffix}`} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
