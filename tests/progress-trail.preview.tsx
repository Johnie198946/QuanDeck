import React from 'react';
import { createRoot } from 'react-dom/client';
import { TaskProgressTrail } from '../src/components/journal/TaskProgressTrail';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { createProgressFixture } from './progress-trail.fixture';
import '../src/index.css';

// Component preview only; it never mounts the application's runtime controller.
const { snapshot, scope } = await createProgressFixture();
const waiting = structuredClone(snapshot);
waiting.sessions['progress-fixture-session'].status = 'waiting_permission';
waiting.sessions['progress-fixture-session'].runtime!.requests = { grant: { id: 'grant', kind: 'permission', prompt: '需要允许读取当前项目的酒店资料' } };
const cases = [
  { title: '项目进展', snapshot, compact: true, scope: undefined },
  { title: '当前任务', snapshot, compact: false, scope },
  { title: '等待授权', snapshot: waiting, compact: true, scope },
  { title: '还未开始', snapshot: createEmptySnapshot(), compact: true, scope: undefined },
];
createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 1040, padding: 24, margin: 'auto' }}>
  <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>进展轨迹 · 隔离验收</h1>
  {cases.map(({ title, ...props }) => <article key={title} data-case={title} style={{ minWidth: 0 }}><h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{title}</h2><TaskProgressTrail {...props}/></article>)}
</main>);
