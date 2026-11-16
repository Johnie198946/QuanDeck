import assert from 'node:assert/strict';
import { redactRuntimeText, pendingDiscussion, runtimeProgress } from '../src/data/runtimePresentation';
import type { RuntimeRunView } from '../src/integration/desktop';

const secret = 'my-long-secret-key';
for (const input of [`Authorization: Bearer ${secret}`, `api_key=${secret}`, `{"access_token":"${secret}"}`, `https://host/path?token=${secret}&mode=1`]) assert.ok(!redactRuntimeText(input).includes(secret), input);
assert.equal(redactRuntimeText('预算 20,000 元；预计 40–60 分钟'), '预算 20,000 元；预计 40–60 分钟');
const value = { summary: '方向', proposals: ['**曼谷两晚**', '芭提雅两晚'], questions: [], cards: [], charts: [], attachments: [] };
const events = [{ id:'1', at:'2026-11-17T00:00:00Z', message:{role:'user',id:'u1',text:'我确认以下信息：\n- 曼谷两晚\n\n我的补充回答：\n无'} }];
assert.deepEqual(pendingDiscussion(value, events).proposals, ['芭提雅两晚']);
assert.deepEqual(pendingDiscussion(value, [{...events[0],message:{...events[0].message,role:'assistant'}}]).proposals, value.proposals, 'Agent cannot confirm its own suggestions');
const run:RuntimeRunView={runId:'test',status:'running',acceptedAt:'2026-11-17T00:00:00Z',events:[{id:'a',at:'2026-11-17T00:01:00Z',step:{label:'查询地图'}}]};
const progress=runtimeProgress(run,Date.parse('2026-11-17T00:03:00Z'));
assert.equal(progress.elapsed,180);assert.equal(progress.silent,120);assert.equal(progress.progress?.mode,'unknown');assert.equal(progress.progress?.value,undefined);
run.events.push({id:'child',targetSessionId:'child',at:'2026-11-17T00:02:00Z',step:{label:'unrelated'}});
assert.equal(runtimeProgress(run,Date.now()).recent.length,1,'child activity must not replace parent progress');
run.status='paused';assert.equal(runtimeProgress(run,Date.now()).elapsed,60,'pause freezes elapsed clock at last source event');
console.log('Runtime presentation: redaction, explicit confirmation filtering and real activity progress passed');
