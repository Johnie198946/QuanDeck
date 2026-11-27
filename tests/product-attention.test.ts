import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { homeBoardCards } from '../src/components/homepage/homeBoardData';
import { projectRegister } from '../src/components/projects/projectRegister';
import { productReminderHidden, selectProductAttention } from '../src/data/productAttention';

const values = new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}});

async function run() {
  const source = new LocalWorkdeckDataSource();
  const projectId = (await source.createProject({name:'产品验收'})).projectId!;
  const taskId = (await source.createTaskWithAttachments('【领导交办】展示交付物',[],projectId)).taskId!;
  const innocent = (await source.createTaskWithAttachments('采访领导交办流程',[],projectId)).taskId!;
  const snap = await source.load();
  const clock = Date.parse('2026-11-25T09:00:00+08:00');
  for (const id of [taskId,innocent]) snap.tasks[id].due={date:'2026-11-24',precision:'date',rawText:'11 月 24 日'};
  snap.collaboration!.tasks[taskId].status='in_review';
  const other = structuredClone(snap);
  other.project.id = 'another-project';
  other.collaboration!.tasks[taskId].status = 'ready';
  const rows = selectProductAttention([snap,other],clock);
  const urgent = rows.find(r => r.projectId===projectId&&r.taskId===taskId)!;
  assert.equal(urgent.kind,'review','acceptance takes precedence over a due date');
  assert.equal(urgent.urgent,true);
  assert.equal(rows.find(r=>r.taskId===innocent)?.urgent,false,'do not infer who requested it');
  assert.equal(rows.filter(r=>r.taskId===taskId).length,2,'same task IDs in separate projects never suppress each other');
  const taskNode = (snapshot: typeof snap, id: string) => projectRegister(snapshot, clock).children.find(node => node.taskId === id)!;
  const cardFor = (snapshot:typeof snap,id:string) => homeBoardCards([snapshot],[],new Map(),clock).find(card=>card.taskId===id)!;
  assert.equal(cardFor(snap,taskId).state,'review');
  assert.deepEqual([cardFor(other,taskId).state,cardFor(other,taskId).reason],['pending','已逾期']);
  const review = taskNode(snap, taskId);
  assert.deepEqual([review.state,review.bucket,review.attention?.action], ['待验收','attention','去验收']);
  assert.deepEqual([taskNode(other,taskId).state,taskNode(other,taskId).attention?.action], ['已逾期','看任务']);
  const dependency = structuredClone(other);
  dependency.collaboration!.tasks[taskId].dependencies = [innocent];
  assert.equal(cardFor(dependency,taskId).state,'blocked');
  assert.match(cardFor(dependency,taskId).reason!,/采访领导交办流程/);
  const stale = structuredClone(snap);
  stale.collaboration!.tasks[taskId].requiresRevalidation = true;
  assert.deepEqual([taskNode(stale,taskId).state,taskNode(stale,taskId).attention?.action], ['需复核','去复核']);
  const quiet = structuredClone(other);
  delete quiet.tasks[taskId].due;
  assert.equal(taskNode(quiet,taskId).attention,undefined,'inactive task never inherits another task’s reminder');
  assert.equal(taskNode(quiet,taskId).bucket,'pending');
  for (const [status,label,action] of [
    ['waiting_permission','待授权','查看授权'], ['waiting_reply','待回复','去回复'], ['failed','遇到问题','查看原因'],
  ] as const) {
    const alert = structuredClone(snap);
    alert.sessions.signal = {id:'signal',taskId,agentId:'codex',title:'源会话',origin:'observed',status,startedAt:null,lastActivity:alert.now,step:null,tokens:null,rounds:[],subAgents:[]};
    alert.tasks[taskId].sessionIds.push('signal');
    if(status==='failed') alert.collaboration!.tasks[taskId].status='ready';
    const node = taskNode(alert,taskId);
    assert.deepEqual([node.state,node.attention?.action],[label,action]);
    assert.equal(cardFor(alert,taskId).state,'blocked');
  }
  const deferred = {[urgent.id]:{action:'later' as const,at:clock,until:clock+60_000}};
  assert.equal(productReminderHidden(urgent,deferred,clock+10),true);
  assert.equal(productReminderHidden(urgent,deferred,clock+60_000),false);
  assert.equal(productReminderHidden({...urgent,kind:'permission'},deferred,clock),false,'a tool request cannot be hidden by a reminder setting');
  assert.equal(productReminderHidden({...urgent,id:`${urgent.id}:new`},deferred,clock),false,'new evidence may be surfaced again');
  console.log('product attention: explicit priority, source scopes, action precedence, reminder expiry and request visibility');
}
void run();
