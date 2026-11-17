import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource, readAgentConclusion } from '../src/data/runtimeDataSource';
import { readPlanTasks } from '../src/data/projectWorkflow';
import { latestGoalPlan } from '../src/data/goalDelivery';
import { buildDiscussionBrief, normalizeDiscussionState } from '../src/data/discussion';
import { seedTaskDirection, scopedBreakdownIssue, scopedBreakdownInstructions } from '../src/data/scopedDiscussion';
import { PLAN_BREAKDOWN_INSTRUCTIONS, parseDiscussionResponse } from '../src/data/discussionPresentation';
import { generateDraftsIn } from '../src/data/ideaEngine';
import type { RuntimeDriver, RuntimeEvent, RuntimeRunInput } from '../src/data/runtimeContracts';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key:string) => storage.get(key) ?? null, setItem:(key:string,value:string)=>storage.set(key,value), removeItem:(key:string)=>storage.delete(key) } });
const task = (key:string,title:string,expected:string,parentKey?:string) => ({ key,title,expected,parentKey,owner:'agent',phase:'执行',deps:[] });
async function main() {
  const base = new LocalWorkdeckDataSource();
  const projectId=(await base.createProject({name:'范围回归',description:'制作三章可验收的入门文档'})).projectId!;
  await base.registerAgent({id:'codex',name:'Codex',short:'C',color:'#111111'});
  const projectPlan=await base.ensureProjectPlan(projectId);
  const graph=readPlanTasks([task('intro','编制介绍','第一章正文'),task('intro-body','起草介绍','说明用途','intro'),task('handoff','编制状态与交接说明','第二章正文'),task('handoff-body','起草状态与交接内容','明确交付与验收的区别、负责人核对和未完成章节留空。','handoff'),task('handoff-example','制作状态对照示例','对照表','handoff'),task('final','整理最终文档','第三章汇总'),task('final-check','检查章节','核对完整性','final')])!;
  assert((await base.recordDiscussionConclusion(projectPlan,'root',{summary:'按三章分别执行',confirmed:[],open:[],tasks:graph})).ok);
  let snapshot=await base.load();
  assert((await base.approvePlan(projectPlan,snapshot.ideaPlans![projectPlan].discussion!.conclusions.at(-1)!.id,projectId,1)).ok);
  snapshot=await base.load(); const goal=latestGoalPlan(snapshot,projectPlan)!;
  const binding=goal.tasks.find(value=>value.draftKey.endsWith('-handoff-body'))!;
  const leafPlanId=await base.openLocalPlan(binding.taskId,binding.workItemId!);
  snapshot=await base.load();let plan=snapshot.ideaPlans![leafPlanId];
  assert.match(plan.draft.sections.find(section=>section.id==='s-goal')!.lines[0].text,/明确交付与验收/);
  assert.match(plan.draft.sections.find(section=>section.id==='s-acceptance')!.lines[0].text,/负责人核对/);
  const brief=buildDiscussionBrief(snapshot,plan,'root');assert.match(brief,/台帐要求 v1/);assert.match(brief,/未完成章节留空/);assert.doesNotMatch(brief,/与我多轮澄清/);
  assert.doesNotMatch(scopedBreakdownInstructions(snapshot,plan,'root',PLAN_BREAKDOWN_INSTRUCTIONS),/项目方向需要多个真正业务主任务/);
  assert.match(scopedBreakdownInstructions(snapshot,snapshot.ideaPlans![projectPlan],'root',PLAN_BREAKDOWN_INSTRUCTIONS),/项目方向需要多个真正业务主任务/);
  assert(scopedBreakdownIssue(snapshot,plan,'root',graph)?.includes('越界'));
  assert(scopedBreakdownIssue(snapshot,plan,'s-goal',readPlanTasks([task('new','新增检查','检查')]))?.includes('章节'));
  // Repair only empty inherited content, not user edits or already adopted documents.
  const repaired=structuredClone(snapshot), empty=repaired.ideaPlans![leafPlanId];empty.draft.sections=[{id:'s-goal',title:'目标',kind:'key',lines:[]}];
  assert(normalizeDiscussionState(repaired));assert.match(empty.draft.sections[0].lines[0].text,/明确交付/);
  empty.draft.sections[0].lines[0].text='用户自定目标';assert.equal(seedTaskDirection(repaired,empty),false);assert.equal(empty.draft.sections[0].lines[0].text,'用户自定目标');
  empty.adopted={version:1,draftVersion:1,doc:structuredClone(empty.draft),at:snapshot.now};empty.draft.sections[0].lines=[];assert.equal(seedTaskDirection(repaired,empty),false);

  const calls:RuntimeRunInput[]=[];let listener=(_event:RuntimeEvent)=>{};
  const driver:RuntimeDriver={subscribe:fn=>{listener=fn;return()=>{};},scan:async()=>({sessions:[]}),listRuns:()=>[],control:async()=>{},run:async input=>{calls.push(input);return {runId:`scope-run-${calls.length}`,sessionId:`scope-source-${calls.length}`,connectionId:input.connectionId,acceptedAt:new Date().toISOString()};}};
  const runtime=createRuntimeDataSource(base,driver);await runtime.bindRuntimeConnection('codex',{tool:'codex',connectionId:'scope-fixture',projectPath:'/isolated-scope-fixture'});
  const discussion=await runtime.startDiscussion(leafPlanId,'codex');assert(discussion.ok,discussion.message);
  assert.match(calls[0].prompt,/当前任务目标（台帐要求 v1）/);assert.match(calls[0].prompt,/未完成章节留空/);assert.doesNotMatch(calls[0].prompt,/项目方向需要多个真正业务主任务/);
  listener({id:'scope-bad',sequence:1,at:new Date().toISOString(),runId:'scope-run-1',sessionId:'scope-source-1',reply:{id:'scope-bad-reply',text:`<quandeck-conclusion>${JSON.stringify({summary:'再次拆全项目',confirmed:[],open:[],tasks:graph})}</quandeck-conclusion>`}});await runtime.flushRuntime();
  snapshot=await base.load();plan=snapshot.ideaPlans![leafPlanId];assert.deepEqual(plan.discussion!.conclusions.at(-1)!.tasks,[]);assert(plan.discussion!.conclusions.at(-1)!.open.some(text=>text.includes('越界')));
  // Previously proposed local work can be withdrawn without deleting the materialized project graph.
  const localTasks=readPlanTasks([task('local-check','检查本节术语','用语一致')])!;
  assert((await base.recordDiscussionConclusion(leafPlanId,'root',{summary:'可选局部检查',confirmed:[],open:[],tasks:localTasks})).ok);
  await base.generateDrafts(leafPlanId);snapshot=await base.load();assert.equal(snapshot.ideaPlans![leafPlanId].drafts.length,1);
  const response={summary:'撤回重复拆分，只保留本子任务方向正文。',confirmed:[],open:[],tasks:[],outline:[{id:'handoff-content',title:'状态与交接内容',kind:'body',lines:[{id:'handoff-standard',text:'解释交付、验收和未完成章节的处理方式。',state:'tentative'}]}]};
  for (const raw of [`<quandeck-conclusion>${JSON.stringify(response)}</quandeck-conclusion>`,JSON.stringify(response),'```json\n'+JSON.stringify(response)+'\n```']) {
    const parsed=readAgentConclusion(raw);assert.equal(parsed.summary,parseDiscussionResponse(raw).conclusion?.summary);assert.deepEqual(parsed.tasks,[]);assert.equal(parsed.outline?.[0].title,'状态与交接内容');
  }
  const legacy=structuredClone(snapshot), legacyPlan=legacy.ideaPlans![leafPlanId];
  legacyPlan.discussion!.conclusions.push({id:'legacy-parser-fallback',agentId:'codex',scopeId:'root',recordedAt:snapshot.now,source:'agent',summary:`<quandeck-conclusion>${JSON.stringify(response)}</quandeck-conclusion>`,confirmed:[],open:[]});
  assert(normalizeDiscussionState(legacy));assert.equal(legacyPlan.discussion!.conclusions.at(-1)!.summary,response.summary);assert.deepEqual(legacyPlan.discussion!.conclusions.at(-1)!.tasks,[]);assert.equal(legacyPlan.discussion!.conclusions.at(-1)!.outline?.length,1);
  assert.deepEqual(readPlanTasks([]),[]);assert.equal(readPlanTasks(undefined),undefined);
  const before=Object.keys(snapshot.collaboration!.tasks).filter(key=>!key.startsWith('planning:')).sort();
  listener({id:'scope-withdraw',sequence:2,at:new Date().toISOString(),runId:'scope-run-1',sessionId:'scope-source-1',reply:{id:'scope-withdraw-reply',text:`<quandeck-conclusion>${JSON.stringify(response)}</quandeck-conclusion>`}});await runtime.flushRuntime();
  snapshot=await base.load();plan=snapshot.ideaPlans![leafPlanId];const latest=plan.discussion!.conclusions.at(-1)!;
  assert.equal(latest.summary,response.summary);assert.equal(latest.outline?.length,1);
  generateDraftsIn(snapshot,leafPlanId);assert.equal(plan.drafts.length,0,'explicit empty task list must not revive an older nonempty proposal');
  assert((await base.approvePlan(leafPlanId,latest.id,projectId,plan.draftVersion)).ok,'outline-only leaf direction remains approvable');
  snapshot=await base.load();assert.equal(snapshot.ideaPlans![leafPlanId].drafts.length,0);assert(snapshot.ideaPlans![leafPlanId].draft.sections.some(section=>section.id==='handoff-content'));
  assert.deepEqual(Object.keys(snapshot.collaboration!.tasks).filter(key=>!key.startsWith('planning:')).sort(),before,'withdrawal never deletes already-materialized project tasks');
  assert.equal(latestGoalPlan(snapshot,projectPlan)!.tasks.length,7);
  runtime.dispose();
  console.log('discussion scope: task goals/criteria, scoped prompts, cross-scope rejection, JSON parity, empty withdrawal and existing task preservation passed');
}
void main();
