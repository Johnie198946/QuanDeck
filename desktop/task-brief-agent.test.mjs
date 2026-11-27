import assert from 'node:assert/strict';
import test from 'node:test';
import {createTaskBriefReader} from './app/task-brief-agent.mjs';
const revision = 'a'.repeat(64);
const points = [{section:'current',text:'台卡已交稿。',source:'s1',quote:'已交稿'}];
function fixture() {
  const data = {revision, rows:[{id:'s1',label:'进展',text:'台卡已交稿。'}]};
  const control = {calls:0, prior:undefined, points, data, tool:'codex'};
  const read = createTaskBriefReader({input: async key => key === 'card' ? control.data : undefined,
    selected:()=>({tool:control.tool,connectionId:'test'}),assist:async req=>{
      control.calls++;
      await control.gate;
      assert.equal(req.projectId,'personal-knowledge');
      return {...req,sourceSessionId:'session',contextPolicy:'new-isolated-session',toolPolicy:'read-only-isolated',output:{points:control.points}};
    }});
  return {control,call:()=>read('card',undefined,revision),read};
}
test('opening twice shares a request and completed evidence is reused', async()=>{
  const {control,call} = fixture();
  const [a,b] = await Promise.all([call(),call()]);
  assert.deepEqual(a,b);assert.deepEqual((await call()).points,points);assert.equal(control.calls,1);
});
test('rejects wrong card, stale data, stale Agent and unsupported quotes', async()=>{
  const {control,read,call}=fixture();
  await assert.rejects(read('second-card',undefined,revision));
  let release;control.gate=new Promise(resolve=>{release=resolve;});
  const pending=call();await new Promise(resolve=>setImmediate(resolve));control.data={...control.data,revision:'f'.repeat(64)};release();
  await assert.rejects(pending,/变化/);
  control.data.revision=revision;
  control.points=[{...points[0],quote:'确认完成验收'}];
  await assert.rejects(call(),/原文/);
  control.points=points;
  control.gate=new Promise(resolve=>{release=resolve;});const other=call();await new Promise(resolve=>setImmediate(resolve));control.tool='claude';release();await assert.rejects(other,/变化/);
});
