import assert from 'node:assert/strict';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { applyCollaboration, ensureCollaboration, type CollaborationActor } from '../src/data/collaboration';
import { annotationHistory, filterAnnotationHistory, taskAnnotationContext } from '../src/data/annotationHistory';

const snapshot = createEmptySnapshot({id:'history-test',name:'Synthetic history'});
const c = ensureCollaboration(snapshot);
c.decisions = [1,2,3].map(revision => ({id:`d${revision}`,decisionId:'thread',revision,
  text: revision === 1 ? '原文\n第二行' : revision === 2 ? '修改内容' : '撤回理由',
  kind:'constraint',authority:revision === 3 ? 'withdrawn' : 'confirmed',source:'human',
  at:`2026-01-0${revision}T09:00:00.000Z`}));
c.artifacts.push({id:'artifact-old',artifactId:'artifact',version:1,key:'missing',title:'旧成果',body:'旧版正文',sourceIds:[],createdAt:'',observedAt:'',hash:'old'});
c.artifacts.push({...c.artifacts[0],id:'artifact-new',version:2,body:'新版正文'});
c.submissions.push({id:'submission',artifactId:'artifact-old',key:'missing',specRevision:1,at:'',actor:'human',unresolved:[],nextSteps:[]});
c.reviews.push({id:'review',submissionId:'submission',key:'missing',verdict:'needs_changes',at:'2026-01-04T00:00:00.000Z',reviewer:'human',note:'请修改旧版',criteria:[]});
c.discussionFeedback = [{binding:{projectId:snapshot.project.id,taskId:'missing',planId:'missing',conclusionId:'conclusion',draftVersion:3},feedbackId:'feedback',blockId:'block',blockHash:'hash',text:'保留讨论原文',action:'comment',recordedAt:'2026-01-05T00:00:00.000Z',delivery:'sent'}];
const before = JSON.stringify(snapshot);
const entries = annotationHistory(snapshot);
assert.equal(JSON.stringify(snapshot),before,'reading history must not mutate project state');
assert.equal(entries.length,5);
assert.equal(entries.at(-1)?.text,'原文\n第二行');
assert.equal(entries.find(e=>e.id==='d1')?.nextId,'d2');
assert.equal(entries.find(e=>e.id==='d2')?.previousId,'d1');
assert.equal(entries.find(e=>e.id==='d3')?.state,'withdrawn');
assert.equal(entries.find(e=>e.id==='d1')?.state,'revised');
assert.equal(entries.find(e=>e.id==='review')?.sourceText,'旧版正文','pin exact reviewed artifact instead of latest');
assert.match(entries.find(e=>e.id==='review')!.version,/成果 v1/);
assert.equal(entries.find(e=>e.id==='feedback')?.sourceId,'conclusion','deleted source retains original reference');
assert.equal(filterAnnotationHistory(entries,'原文','all','all','','').length,2);
assert.equal(filterAnnotationHistory(entries,'','condition','withdrawn','','').length,1);
assert.equal(filterAnnotationHistory(entries,'旧版','review','all','2026-01-04','2026-01-04').length,1);
assert.equal(filterAnnotationHistory(entries,'','all','all','2026-02-01','2026-01-01').length,0);
assert.deepEqual(annotationHistory(JSON.parse(JSON.stringify(snapshot))),entries,'persisted snapshots preserve relations and source versions');
assert.deepEqual(annotationHistory(createEmptySnapshot()),[]);
const notesProject = createEmptySnapshot({id:'notes-test',name:'批注测试'});
let commandNumber = 0;
const createNoteTask = (title: string) => applyCollaboration(notesProject, {
  type:'create_task', projectId:'notes-test', idempotencyKey:title, payload:{title,goal:title,criteria:['可查'],owner:'me'},
}, {kind:'human'}).resourceId!;
const firstTask = createNoteTask('车票'), otherTask = createNoteTask('住宿');
const saveNote = (taskId: string, text: string, expectedRevision: number, actor: CollaborationActor = {kind:'human'}) =>
  applyCollaboration(notesProject, {
    type:'write_task_annotation', taskId, projectId:'notes-test', idempotencyKey:String(++commandNumber),
    expectedVersion:notesProject.collaboration!.tasks[taskId].version, payload:{text, expectedRevision},
  }, actor);
const initial = saveNote(firstTask,'标出日期',0);
assert.ok(initial.ok, initial.message);
assert.equal(saveNote(firstTask,'忽略日期',0).code,'VERSION_CONFLICT');
assert.equal(saveNote(firstTask,'覆盖意见',1,{kind:'runtime'}).ok,false);
assert.ok(saveNote(otherTask,'记下地址',0).ok);
assert.equal(saveNote(firstTask,'标出日期',1).resourceId,initial.resourceId);
const revised = saveNote(firstTask,'标出出发日期',1);
assert.ok(revised.ok,revised.message);
const taskNotes = annotationHistory(JSON.parse(JSON.stringify(notesProject))).filter(entry=>entry.kind==='note');
assert.equal(taskNotes.length,3);
assert.deepEqual(taskNotes.filter(n=>n.taskId===otherTask).map(n=>n.text),['记下地址']);
assert.equal(taskNotes.find(n=>n.id===revised.resourceId)?.previousId,initial.resourceId);
assert.equal(taskNotes.find(n=>n.id===initial.resourceId)?.nextId,revised.resourceId);
assert(applyCollaboration(notesProject,{type:'set_member',projectId:'notes-test',idempotencyKey:'second-author',
  payload:{principalId:'editor-2',role:'editor',active:true}},{kind:'human'}).ok);
const secondAuthor = saveNote(firstTask,'同时写上验票时间',0,{kind:'human',principalId:'editor-2'});
assert.ok(secondAuthor.ok,secondAuthor.message);
const latest = taskAnnotationContext(notesProject, firstTask);
assert.deepEqual(latest.pins.map(note => [note.id,note.author,note.revision]), [
  [revised.resourceId,'local-user',2],[secondAuthor.resourceId,'editor-2',1]
]);
assert(!latest.text.includes('记下地址') && !latest.text.includes(initial.resourceId!));
assert.deepEqual(taskAnnotationContext(createEmptySnapshot(),firstTask), {text:'',pins:[]});
console.log('annotation history tests passed');
