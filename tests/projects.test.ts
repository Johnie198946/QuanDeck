import { checkedTaskAcceptance } from './manual-acceptance.fixture';
import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { LOCAL_PROJECTS_KEY, createEmptySnapshot, readProjectLibrary, persistProjectLibrary } from '../src/data/projectStorage';

const memory = new Map<string, string>();
let failSave = false;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { if (failSave) throw new Error('quota'); memory.set(key, value); },
  removeItem: (key: string) => memory.delete(key),
} });
const old = '{"old":"demo and user legacy record"}'; memory.set('quandeck.demo.v3', old);
(async () => {
  const source = new LocalWorkdeckDataSource();
  const clean = await source.load();
  assert.equal(source.mode, 'local'); assert.equal(source.demo, undefined);
  assert.equal(clean.project.id, ''); assert.deepEqual(clean.tasks, {}); assert.deepEqual(clean.agents, []);
  assert.deepEqual(clean.sessions, {}); assert.deepEqual(clean.plans, []); assert.deepEqual(await source.listProjects(), []);
  assert.equal(memory.get('quandeck.demo.v3'), old);
  await assert.rejects(source.addBlock('task', 'no project'), /新建项目/);
  const a = (await source.createProject({ name: '旅行', color: '#A94435' })).projectId!;
  const block = await source.addBlock('task', '准备行程');
  const taskId = (await source.load()).journal.blocks.find(b => b.id === block)!.kind === 'task'
    ? ((await source.load()).journal.blocks.find(b => b.id === block) as {taskId:string}).taskId : '';
  assert.equal((await source.load()).tasks[taskId].owner, 'me');
  const child = (await source.addManualSubtask(taskId, taskId, '安排交通')).itemId!;
  const nested = (await source.addManualSubtask(taskId, child, '比较火车班次')).itemId!;
  const output = await source.saveTaskOutput({ projectId:a, taskId, workItemId:nested, title:'交通方案', body:'乘坐上午的火车', status:'draft' });
  assert(output.ok && output.outputId);
  assert.equal((await source.load()).outputs![output.outputId!].status,'draft');
  assert.equal((await source.load()).orchestrations![taskId].items[nested].status,'not_started');
  assert.equal((await source.saveTaskOutput({ id:output.outputId, taskId, workItemId:nested, title:'交通方案',body:'上午火车',status:'draft',complete:true })).ok,false);
  const published = await source.saveTaskOutput({ ...checkedTaskAcceptance(await source.load(), taskId, nested), id:output.outputId, taskId, workItemId:nested, title:'交通方案', body:'上午火车', complete:true });
  assert(published.ok); assert.equal((await source.load()).outputs![output.outputId!].status,'published');
  assert.equal((await source.load()).orchestrations![taskId].items[nested].status,'done');
  assert.equal((await source.load()).tasks[taskId].completion,null,'child completion does not complete parent');
  await assert.rejects(source.completeTask(taskId), /先提交成果/);
  assert.equal((await source.load()).tasks[taskId].completion,null,'completion requires evidence and review');
  assert((await source.saveTaskOutput({...checkedTaskAcceptance(await source.load(), taskId, child),taskId,workItemId:child,title:'交通检查',body:'班次和交通衔接已经人工核对',complete:true})).ok);
  assert((await source.saveTaskOutput({...checkedTaskAcceptance(await source.load(), taskId),taskId,title:'行程总交付',body:'交通已汇总，完成整个准备目标',complete:true})).ok);
  assert((await source.load()).tasks[taskId].completion);
  assert.equal((await source.load()).collaboration!.reviews.length,3,'manual completion is explicit review evidence, with zero AI runs');
  assert((await source.addManualSubtask(taskId,nested,'重新核对出发时间')).ok);
  assert.equal((await source.load()).tasks[taskId].completion,null,'new subtask reopens the root');
  assert.equal((await source.load()).orchestrations![taskId].items[nested].status,'not_started','new child reopens completed ancestor');
  assert.deepEqual((await source.load()).sessions,{}); assert.equal((await source.load()).stats.tokens,0);
  const b = (await source.createProject({ name:'写作' })).projectId!;
  assert.deepEqual((await source.load()).tasks,{}); assert.deepEqual((await source.load()).outputs,{});
  assert.equal((await source.saveTaskOutput({ projectId:a,taskId,title:'错误项目',body:'必须拒绝' })).ok,false);
  assert.equal((await source.addManualSubtask(taskId,taskId,'wrong')).ok,false);
  await source.addBlock('task','写文章');
  const reopened = new LocalWorkdeckDataSource(); assert.equal((await reopened.load()).project.id,b);
  await reopened.switchProject(a); assert.equal((await reopened.load()).outputs![output.outputId!].body,'上午火车');
  assert.equal((await reopened.listProjects()).length,2);
  assert.equal((await reopened.getProjectSnapshot(b))?.project.name,'写作');
  assert.equal(await reopened.getProjectSnapshot('missing'),undefined);
  await reopened.updateProject(a,{name:'泰国旅行',description:'交通与住宿'});
  assert.equal((await reopened.load()).project.name,'泰国旅行');
  const before=await reopened.load(); failSave=true;
  await assert.rejects(reopened.addBlock('task','cannot save'),/未保存/);
  assert.deepEqual(await reopened.load(),before,'failed persistence rolls back the in-memory mutation'); failSave=false;
  assert.equal((await reopened.dispatch(taskId,'codex')).ok,false);
  assert.equal((await reopened.scanAgent('codex')).ok,false);
  assert.deepEqual((await reopened.load()).sessions,{});
  await reopened.registerAgent({id:'codex',name:'Codex',short:'Codex',color:'#556677'});
  await reopened.switchProject(b); assert.equal((await reopened.load()).agents[0].id,'codex');
  await reopened.switchProject(a);
  assert.equal((await reopened.saveTaskOutput({taskId,title:'Unsafe',body:'',links:[{label:'x',url:'javascript:alert(1)'}]})).ok,false);
  assert.equal((await reopened.saveTaskOutput({id:output.outputId,taskId,title:'Moved',body:'bad'})).ok,false,'cannot move child output to root by editing');
  assert((await reopened.deleteTaskOutput(output.outputId!)).ok);
  assert.equal((await reopened.load()).outputs![output.outputId!],undefined);
  assert.equal(memory.get('quandeck.demo.v3'),old);
  assert(memory.has(LOCAL_PROJECTS_KEY));
  const stored = JSON.parse(memory.get(LOCAL_PROJECTS_KEY)!);
  stored.projects[a].sessions['observed-test'] = { id:'observed-test', agentId:'codex', title:'真实记录测试', origin:'observed', taskId:null, status:'archived', startedAt:'10:00', endedAt:'10:05', lastActivity:'10:05', step:null, tokens:5, rounds:[], subAgents:[] };
  memory.set(LOCAL_PROJECTS_KEY, JSON.stringify(stored));
  const pendingSource = new LocalWorkdeckDataSource();
  const observedProjects:string[]=[]; pendingSource.subscribe(s=>observedProjects.push(s.project.id));
  const pending = pendingSource.linkSession('observed-test',taskId);
  await pendingSource.switchProject(b);
  assert((await pending).ok);
  assert.equal((await pendingSource.load()).project.id,b);
  assert.deepEqual((await pendingSource.load()).sessions,{});
  assert.equal((await pendingSource.listProjects()).find(s=>s.project.id===a)!.sessions['observed-test'].taskId,taskId);
  assert(observedProjects.every(id=>id===b),'pending operations never flash the previous project');
  const routed=await pendingSource.applyExecutionEvent({ projectId:a,agentId:'codex',sessionId:'observed-test',executionId:'session:observed-test',taskId,status:'running',at:new Date().toISOString(),id:'event-test',sequence:1 } as any);
  assert(routed.ok);
  assert.equal((await pendingSource.load()).project.id,b);

  // Updating shared configuration must not turn one project's usage into a new project's history.
  const usageLibrary = JSON.parse(memory.get(LOCAL_PROJECTS_KEY)!);
  usageLibrary.activeProjectId = a;
  usageLibrary.projects[a].agents[0].today = { minutes: 24, tokens: 12500, sessions: 3 };
  usageLibrary.projects[a].agents[0].daily14 = [1200, 12500];
  usageLibrary.projects[a].agents[0].scan = { state: 'idle', lastAt: '10:05', note: 'Imported 3 sessions' };
  memory.set(LOCAL_PROJECTS_KEY, JSON.stringify(usageLibrary));
  const configuredSource = new LocalWorkdeckDataSource();
  await configuredSource.toggleStar('codex');
  assert.equal(JSON.parse(memory.get(LOCAL_PROJECTS_KEY)!).agents[0].today.tokens, 12500);
  const freshProjectId = (await configuredSource.createProject({ name: '无历史的新项目' })).projectId!;
  const freshProject = await configuredSource.load();
  assert.equal(freshProject.agents[0].id, 'codex');
  assert.equal(freshProject.agents[0].starred, true);
  assert.equal(freshProject.defaultAgent, 'codex');
  assert.deepEqual(freshProject.agents[0].today, { minutes: null, tokens: null, sessions: null });
  assert.deepEqual(freshProject.agents[0].daily14, []);
  assert.deepEqual(freshProject.agents[0].scan, { state: 'idle', lastAt: null });
  assert.deepEqual(freshProject.activity, []);
  assert.deepEqual(freshProject.sessions, {});
  assert.deepEqual(freshProject.stats, { collabMinutes: 0, wallMinutes: 0, tokens: 0, sessions: 0 });
  const freshReloaded = await new LocalWorkdeckDataSource().load();
  assert.equal(freshReloaded.project.id, freshProjectId);
  assert.deepEqual(freshReloaded.agents[0].today, { minutes: null, tokens: null, sessions: null });
  assert.deepEqual(freshReloaded.agents[0].daily14, []);

  // The desktop persistence adapter must never serialize unchanged projects.
  const partitionLibrary={schema:1 as const,activeProjectId:'a',agents:[],defaultAgent:'',projects:{a:createEmptySnapshot({id:'a',name:'A'}),b:createEmptySnapshot({id:'b',name:'B'})}};
  let revision=7, failed=false;
  const writes:Array<{updates:Record<string,string>;expectedRevision:number;projectIds:string[];removed:string[]}>=[];
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    readProjectLibrary:()=>({library:partitionLibrary,revision}),
    writeProjectLibraryChanges:(input:typeof writes[number])=>{writes.push(input);assert.equal(input.expectedRevision,revision);if(failed)throw Error('disk full');return ++revision;},
    getItem:()=>{throw Error('desktop must not read the giant JSON compatibility path');},
    setItem:()=>{throw Error('desktop must not write the giant JSON compatibility path');},
  }});
  const previous=readProjectLibrary();
  Object.defineProperty(previous.projects.b,'toJSON',{value:()=>{throw Error('B history must not be serialized by A');}});
  const changed={...previous,projects:{...previous.projects,a:{...previous.projects.a,version:2}}};
  persistProjectLibrary(changed,previous);
  assert.deepEqual(Object.keys(writes[0].updates),['a']);assert.equal(writes[0].expectedRevision,7);
  const next={...changed,projects:{...changed.projects,a:{...changed.projects.a,version:3}}};
  failed=true;assert.throws(()=>persistProjectLibrary(next,changed),/未保存/);
  failed=false;persistProjectLibrary(next,changed);assert.equal(writes[2].expectedRevision,8);
  const removed={...next,projects:{a:next.projects.a}};persistProjectLibrary(removed,next);
  assert.deepEqual(writes[3].updates,{});assert.deepEqual(writes[3].removed,['b']);

  console.log('projects: clean startup, separate legacy storage, project isolation/persistence, manual hierarchy, draft/publication, no fabricated execution, safe links, failed-save rollback');
})().catch(error=>{console.error(error);process.exitCode=1;});
