import assert from 'node:assert/strict';
import {createEmptySnapshot} from '../src/data/projectStorage';
import {applyCollaboration,ensureCollaboration,type CollaborationDecision} from '../src/data/collaboration';
import {annotationHistory} from '../src/data/annotationHistory';
import {annotationEvolution,compareConditions} from '../src/data/annotationEvolution';

const s=createEmptySnapshot({id:'graph-a',name:'批注对照测试'}), c=ensureCollaboration(s);
const decision=(id:string,text:string,k?:string,family=id,rev=1,authority:CollaborationDecision['authority']='confirmed'):CollaborationDecision=>({id,decisionId:family,revision:rev,taskKey:k,text,kind:'preference',authority,source:'human',at:'2026-01-'+id.slice(-2)+'T12:00:00.000Z'});
c.decisions.push(decision('d01','桌面端的讨论区放在侧栏','t1'),decision('d02','手机端的讨论区放在顶部','t1'),decision('d03','手机端的讨论区放在顶部','t2'),
 decision('d04','历史默认展开','t1','f'),decision('d05','历史默认收起','t1','f',2),decision('d06','收回这条意见','t1','f',3,'withdrawn'),
 decision('d07','不要把讨论区放在顶部','t2'), decision('d08','允许导出报告','t1'),decision('d09','禁止导出报告','t1'),decision('d10','只有管理员在场时允许导出附件','t2'));
const before=JSON.stringify(s), history=annotationHistory(s), g=annotationEvolution(history);
assert.equal(JSON.stringify(s),before); assert.equal(g.ordered[0].id,'d01');
assert.deepEqual(g.revisions.map(p=>[p.earlier.id,p.later.id,p.topic]),[['d05','d06','撤回'],['d04','d05','修改']]);
assert.deepEqual(g.comparisons.map(p=>[p.earlier.id,p.later.id]),[['d08','d09'],['d01','d02']],'do not infer conflicts between different tasks, negations or superseded opinions');
const pair=g.comparisons[1]; assert.equal(compareConditions(pair.earlier),'桌面端');assert.equal(compareConditions(pair.later),'手机端');assert.equal(compareConditions(g.comparisons[0].earlier),'原文未标明适用条件');
const payload={pairId:pair.id,verdict:'separate',note:'设备宽度不同',expectedRevision:0};
const command={projectId:s.project.id,type:'review_annotation_pair' as const,idempotencyKey:'mark',payload};
assert.equal(applyCollaboration(s,command,{kind:'runtime'}).ok,false);
assert.equal(applyCollaboration(s,{...command,projectId:'graph-b'},{kind:'human'}).ok,false);
assert.ok(applyCollaboration(s,command,{kind:'human'}).ok);
const reloaded=JSON.parse(JSON.stringify(s)) as typeof s;
assert.equal(reloaded.collaboration?.annotationJudgments?.[0].verdict,'separate');
assert.equal(annotationEvolution(annotationHistory(reloaded)).comparisons[1].id,pair.id);
assert.deepEqual(c.decisions,JSON.parse(before).collaboration.decisions,'a judgment does not change original annotations');
assert.equal(applyCollaboration(s,{...command,idempotencyKey:'stale-edit',payload:{...payload,verdict:'conflict'}},{kind:'human'}).ok,false);
assert.ok(applyCollaboration(s,{...command,idempotencyKey:'reopen',payload:{...payload,verdict:'unresolved',note:'',expectedRevision:1}},{kind:'human'}).ok);
assert.deepEqual(s.collaboration?.annotationJudgments?.map(j=>j.verdict),['separate','unresolved']);
reloaded.collaboration!.decisions.find(d=>d.id==='d01')!.text+='，细则已改';
assert.equal(applyCollaboration(reloaded,{...command,idempotencyKey:'invalid-source',payload:{...payload,expectedRevision:1}},{kind:'human'}).ok,false);
assert.equal(annotationEvolution([]).comparisons.length,0);
console.log('annotation evolution: scoped trace, real revisions, conditions, human-only durable corrections, stale evidence, CAS and isolation passed');
