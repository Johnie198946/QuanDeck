import assert from 'node:assert/strict';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { purposeMetrics } from '../src/data/purposeMetrics';
import type { Session } from '../src/data/types';
const s = createEmptySnapshot({ id: 'p', name: 'Project', timeZone: 'UTC' });
s.date = '2026-11-16'; s.now = '12:00';
const session = (id: string, purpose: 'discussion' | 'execution') => ({ id, title: id, status: 'archived', agentId: 'a', origin: 'dispatch', taskId: 't', startedAt: null, lastActivity: '2026-11-16T11:00:00Z', step: null, tokens: 100, rounds: [], subAgents: [], runtime: { purpose, dispatchId:id, projectId:'p', taskId:'t', connection:{connectionId:'c',tool:'codex',projectPath:'/tmp'}, context:{taskTitle:id,prompt:'test',capturedAt:'2026-11-16T09:00:00Z'}, sequence:1,eventIds:[], usageSamples: [{at:'2026-11-16T10:00:00Z',tokens:100,delta:50},{at:'2026-11-15T10:00:00Z',tokens:50,delta:50}] }, source: { connectionId: 'c', tool: 'codex', sessionId: id } } as Session);
s.sessions = { d: session('d','discussion'), e: session('e','execution') };
s.sessions.duplicate = { ...s.sessions.d, id: 'duplicate' };
s.timeline = { asOf: '2026-11-16T12:00:00Z', cursors: {}, intervals: [
  {id:'1',executionId:'d',sessionId:'d',agentId:'a',start:'2026-11-16T09:00:00Z',end:'2026-11-16T10:00:00Z',provenance:'event'},
  {id:'2',executionId:'e',sessionId:'e',agentId:'a',start:'2026-11-16T10:00:00Z',end:'2026-11-16T11:00:00Z',provenance:'event'},
  {id:'3',executionId:'e',sessionId:'e',agentId:'a',start:'2026-11-16T10:30:00Z',end:'2026-11-16T11:30:00Z',provenance:'event'},
] };
s.plans = [{ id:'plan',taskId:'t',title:'Manual',kind:'fixed',start:'00:00',minutes:10,actual:[],manualActual:[['2026-11-15T23:30:00Z','2026-11-16T00:30:00Z']] } as typeof s.plans[number]];
assert.deepEqual(purposeMetrics(s), {discussion:{minutes:60,tokens:50},execution:{minutes:90,tokens:50},manual:{minutes:30,tokens:null}});
s.sessions.d.runtime!.usageSamples=[];s.sessions.duplicate.runtime!.usageSamples=[];
assert.equal(purposeMetrics(s).discussion.tokens,null);
console.log('purpose metrics: real discussion/execution/manual split, interval union, cross-day clipping, source usage deduplication, unknown usage retained');
