import assert from 'node:assert/strict';
import { makeSelection, type KnowledgeNote } from '../src/data/knowledgeNotes';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { queryWorkspace, readWorkspaceLookup, workspaceEvidence, type WorkspaceSource } from '../src/data/workspaceQuestion';
import { createSampleSnapshot } from '../src/data/fixtures';
import { createMethodBoard, editableMethodBoard, saveMethodTemplate } from '../src/data/methodBoards';
import { insertInspiration, connectInspirations } from '../src/data/inspirationCanvas';
import { noteLogicGroups, noteLogicPrompt } from '../src/data/noteDispatchLogic';
import { eraseKnowledgeNote, unreferencedNoteFiles } from '../src/data/deleteKnowledgeNote';
import { monitorActivity } from '../src/data/monitorActivity';

const now=Date.parse('2026-11-27T03:00Z'), at=new Date(now).toISOString();
function note(id:string,body:string):KnowledgeNote { return {id,title:id,body,revision:1,createdAt:at,updatedAt:at,expansions:[],attachments:[],history:[]}; }
const n=note('旅行准备','1. ~~第一条~~\n2. 归还车票\n3. 和会场确认集合\n\n```md\n1. 测试文本\n```');
const s=note('工作随记','跨日待办\n拿到材料');
s.todos=[{id:'past',text:'跨日待办',lineIndex:0,dueAt:'2026-11-26T03:00Z',createdAt:at},{id:'now',text:'拿到材料',lineIndex:1,dueAt:at,createdAt:at,completedAt:at,outcome:{at,text:'会务排班表'}}];
const project=createEmptySnapshot({id:'synthetic',name:'京都示例'}), sample=createSampleSnapshot();
const source:WorkspaceSource={library:{schema:1,notes:[n,s],decisions:[],inspirationCanvas:{nodes:[{noteId:'manual',x:0,y:0,idea:{title:'集合顺序',origin:'manual',detail:'先到场'}}],links:[]}},projects:[project],noteId:s.id,selection:makeSelection(s.body,0,1)};
const ask=(q:string)=>queryWorkspace(source,q,q,now)!;
assert.equal(ask('我还有多少任务没有画删除线？').total,4);
assert.equal(ask('《旅行准备》里还有几条没划掉？').total,2);
assert.equal(ask('《已经删除的笔记》里有几条没有画删除线？').total,0);
assert.deepEqual(ask('今天还有哪些未完成的待办').rows.map(r=>r.label),['跨日待办']);
assert.deepEqual(ask('首页成果库有些什么').rows.map(r=>r.label),['会务排班表']);
assert.equal(ask('我有几个项目').total,1);assert.equal(ask('我的项目任务有哪些').total,0);
assert.equal(ask('帮你想有哪些灵感').rows[0]?.target.page,'ideas');
assert.equal(ask('到帮你找查找「归还车票」').rows[0]?.target.page,'notes');
assert.equal(ask('帮你盯有哪些告警').total,0);
assert.equal(queryWorkspace({...source,projects:[sample]},'帮你盯有哪些正在执行的任务','',now)?.total,
  monitorActivity([sample]).filter(r=>r.entry.state==='running').length);
assert.equal(queryWorkspace(source,'请翻译成英语','我还有多少任务没有画删除线？',now),undefined);
assert.throws(()=>readWorkspaceLookup('{"quandeck_lookup":[{"area":"filesystem","search":"a"}]}'));
const many={...source,library:{...source.library,notes:[note('批量',Array.from({length:80},(_,i)=>'- 执行事项'+i).join('\n'))]}};
const count=queryWorkspace(many,'我还有多少任务没有画删除线？','',now)!;
const evidence=workspaceEvidence([count],true);
assert.equal(count.total,80);assert.equal(count.rows.length,80);assert.equal(evidence.reads[0].records.length,32);
console.log('workspace read-only projections: six areas, consistent outcome and monitor counts, explicit scope, retained anchors, complete totals with limited evidence, unsupported operations rejected.');

// Current board, an older board and a saved template can contain the same card/edge IDs.
// A receipt must address the right copy and file cleanup must see every owner.
const multi=structuredClone(source);
const boardId=createMethodBoard(multi.library,'出行流程');
const trip=editableMethodBoard(multi.library,boardId);
const document={id:'fa',name:'出票规则.md',type:'text/markdown',size:20};
insertInspiration(trip,'research',{title:'选票',detail:'查直达',origin:'reference',reference:{file:document},
  method:{component:'比较筛选',input:'预算',output:'候选车次',standard:'不超预算',quote:'只选直达。',sourceTitle:document.name,sourceNote:{id:n.id,revision:1}}});
insertInspiration(trip,'review',{title:'核对日期',detail:'确认出发日',origin:'manual'});
connectInspirations(trip,'research','review');
const templateId=saveMethodTemplate(multi.library,boardId,'我的行程模板','按预算订票');
createMethodBoard(multi.library,'本周新画布');
const lookup=(q:string)=>queryWorkspace(multi,q,q,now)!;
assert.ok(lookup('帮你想有哪些灵感').rows.some(row=>row.label==='选票' && row.target.page==='ideas' && row.target.boardId===boardId));
assert.ok(lookup('我有哪些方法模板').rows.some(row=>row.target.page==='ideas' && row.target.templateId===templateId));
const methods=noteLogicGroups(multi.library);
const group=methods.find(g=>g.id==='template:'+templateId)!;
assert.match(noteLogicPrompt(group.steps),/标准：不超预算/);
assert.notEqual(methods.find(g=>g.title.includes('出行流程'))!.steps[0].id,group.steps[0].id);
eraseKnowledgeNote(multi.library,n.id);
assert.ok(!multi.library.methodTemplates?.[0].board.nodes.some(node=>node.noteId==='research'));
assert.ok(!editableMethodBoard(multi.library,boardId).links.length);
assert.ok(unreferencedNoteFiles(multi.library).includes('fa'));
