import { followupRequest, progressReschedule } from '../src/data/scheduleProgress';
import { createMaterialRecall } from '../src/data/materialRecall';
import assert from 'node:assert/strict';
import { resolveNoteTodoDue } from '../src/data/noteTodoDue';
import { addNoteTodo, addNoteTodoProgress, assignTodoMaterial, saveNoteTodoOutcome, removeNoteTodo, setNoteTodoCompleted } from '../src/data/knowledgeStore';
import { emptyKnowledge, parseKnowledge, updateNote, type KnowledgeNote } from '../src/data/knowledgeNotes';
import { noteTodosForBody, todoLineText, type NoteTodo } from '../src/data/noteTodos';

const now = new Date(2026, 10, 26, 10, 24, 12);
const local = (year: number, month: number, day: number, hour: number, minute: number, second = 0) =>
  new Date(year, month - 1, day, hour, minute, second).toISOString();
const fallback = new Date(+now + 8 * 3600_000).toISOString();
for (const [text, dueAt] of [
  ['今天下班前完成交接', local(2026,11,26,18,0)], ['4点前做完汇报', local(2026,11,26,16,0)],
  ['三点前我要交稿', local(2026,11,26,15,0)], ['今晚八点半整理', local(2026,11,26,20,30)],
  ['明天下午两点一刻交付', local(2026,11,27,14,15)], ['两天后 08:23', local(2026,11,28,8,23)],
  ['大后天交资料', local(2026,11,29,23,59)], ['本周一上午十点', local(2026,11,23,10,0)],
  ['下礼拜二九点三刻', local(2026,12,1,9,45)], ['周末中午取件', local(2026,11,28,12,0)],
  ['二〇二七年一月二日十二点', local(2027,1,2,12,0)], ['12/31 09：05 完成', local(2026,12,31,9,5)],
  ['1月2号整理', local(2027,1,2,23,59)], ['2026-12-01 14:35交付', local(2026,12,1,14,35)],
  ['下个月五号早上七点', local(2026,12,5,7,0)], ['月底总结', local(2026,11,30,23,59)],
  ['半小时后检查', local(2026,11,26,10,54,12)], ['一个半小时后出门', local(2026,11,26,11,54,12)],
  ['三十分钟后复核', local(2026,11,26,10,54,12)], ['整理两份报告', fallback], ['梳理三点建议', fallback],
  ['今天先梳理，明天下午四点前交稿', local(2026,11,27,16,0)],
  ['13:00开会，16:30前交付',local(2026,11,26,16,30)],
  ['参考 https://example.test/2026-12-01/article', fallback],
  ['比较3-5个方案', fallback], ['从 3 - 5 家门店挑选', fallback], ['阅读 2-3 篇论文', fallback],
  ['11-27下午三点前交稿', local(2026,11,27,15,0)],
  ['从3-5家门店挑选，11-27交付清单', local(2026,11,27,23,59)],
  ['周日选择3-5家门店', local(2026,11,29,23,59)], ['星期天下午四点看展',local(2026,11,29,16,0)],
  ['下周日三点前确认',local(2026,12,6,15,0)],
  ['评估第3点', fallback], ['日期无效 2026-02-31', fallback],
]) assert.equal(resolveNoteTodoDue(text, now), dueAt, text);

// Across a daylight-saving switch the fallback is eight elapsed hours, but “tomorrow” is a calendar day.
const spring = new Date(2026,2,7,23,30);
assert.equal(Date.parse(resolveNoteTodoDue('整理资料',spring)) - spring.getTime(),8 * 3600_000);
assert.equal(resolveNoteTodoDue('明天早上九点',spring),local(2026,3,8,9,0));
const late = new Date(2026,11,31,22,10);
assert.equal(resolveNoteTodoDue('更新方案',late), local(2027,1,1,6,10));
assert.equal(resolveNoteTodoDue('明天凌晨十二点',late), local(2027,1,1,0,0));
assert.equal(resolveNoteTodoDue('三点前交稿',late), local(2027,1,1,3,0));
assert.equal(resolveNoteTodoDue('今天四点前交稿',late), local(2026,12,31,16,0));
assert.equal(todoLineText('  2. **联系同事**，准备[讲稿](<https://test.example>)'), '联系同事，准备讲稿');

const morning = new Date(2026, 10, 27, 9, 30);
assert.equal(progressReschedule('今天应该没时间，改到下周一下班前完成',morning),local(2026,11,30,18,0));
assert.equal(progressReschedule('今天可能没时间，改到下周一下午三点',morning),local(2026,11,30,15,0));
for (const report of ['已跟进，11点再确认','别改到下周一','能否改到下周一？','可能改到明天下午','如果改到明天会迟','改到明天或后天','原计划改到周二，但按原时间执行','改到未定日期','昨天改到周一，今天改到周三','对方说改到周三','考虑延期到下周一']) {
  assert.equal(progressReschedule(report,morning),undefined,report);
}
const follow = followupRequest('p', '9点已发消息，11点再确认一遍', morning);
assert.equal(follow.title, '11点再确认一遍');
assert.equal(follow.dueAt, local(2026,11,27,11,0));
assert.equal(followupRequest('p', '今天上午已发，明天，11点，再确认', morning).dueAt, local(2026,11,28,11,0));
assert.equal(followupRequest('p', '再找同事确认', morning).dueAt, local(2026,11,27,10,0));
const friday = new Date(2026,10,27,16,58);
const oldDeadline = +new Date(2026,10,27,18);
for (const wording of ['改期到周一下班前','延期至下周一18:00','挪到礼拜一傍晚','改期周一下班之前','调整为周一18:00']) {
  assert.equal(progressReschedule(wording,friday,oldDeadline), local(2026,11,30,18,0),wording);
}
assert.equal(progressReschedule('改期到周一',friday,+new Date(2026,10,27,16,15)),local(2026,11,30,16,15));
assert.equal(progressReschedule('改期到下周一或周二',friday), undefined);
assert.equal(progressReschedule('不改期到周一了',friday), undefined);
assert.equal(progressReschedule('延期两天',friday,oldDeadline),local(2026,11,29,18,0));
assert.equal(progressReschedule('提前半小时',friday,oldDeadline),local(2026,11,27,17,30));
assert.equal(progressReschedule('改期到周一收工前',friday,oldDeadline),local(2026,11,30,18,0));
assert.equal(followupRequest('f','已追台卡，等回复',friday,oldDeadline).dueAt,local(2026,11,27,17,0));
assert.equal(followupRequest('f','明天凌晨一点再问',friday,oldDeadline).dueAt,local(2026,11,28,1,0));
assert.equal(followupRequest('f','追台卡，明天再问',friday,oldDeadline).dueAt,local(2026,11,28,9,0));
assert.equal(followupRequest('f','3点已发，等回复',new Date(2026,10,27,21,30),oldDeadline).dueAt,local(2026,11,28,9,0));


const time = now.toISOString();
const body = ['先写笔记','', '三点前交稿','背景','三点前交稿','尾行'].join('\n');
const todo: NoteTodo = { id:'todo', lineIndex:4, text:'三点前交稿', dueAt:resolveNoteTodoDue('三点前交稿',now), createdAt:time, completedAt:time };
const note: KnowledgeNote = { id:'note', title:'计划', body, revision:1, createdAt:time, updatedAt:time,
  history:[], expansions:[], attachments:[], todos:[todo] };
const edit = new Date(2026,10,27,10).toISOString();
function edited(body: string) {return updateNote(note, { title:note.title, body }, edit);}
const inserted = edited('新的一行\n' + body);
assert.deepEqual(inserted.todos, [{...todo,lineIndex:5}]);
assert.deepEqual(edited(body.replace('背景\n三点前交稿', '背景\n- **三点前交稿**')).todos, [todo]);
assert.deepEqual(edited(body.replace('背景\n三点前交稿','背景\n三点前交稿给同事')).todos, [{...todo,text:'三点前交稿给同事'}]);
assert.deepEqual(edited(body.replace('背景\n三点前交稿','背景\n明天下午五点交稿')).todos,
  [{...todo,text:'明天下午五点交稿',dueAt:local(2026,11,28,17,0)}]);
assert.deepEqual(edited(body.replace('背景\n三点前交稿\n尾行','背景\n尾行')).todos, []);
assert.deepEqual(edited('先写笔记\n\n三点前交稿\n背景\n尾行\n三点前交稿').todos, [{...todo,lineIndex:5}]);
assert.deepEqual(edited(body.replace('背景\n三点前交稿','背景\n补充备注\n三点前交稿给同事')).todos,
  [{...todo,lineIndex:5,text:'三点前交稿给同事'}]);
assert.deepEqual(noteTodosForBody({body:'旧笔记'},'任意正文'),[]);
assert.deepEqual(note.todos,[todo]);
const library = { ...emptyKnowledge(), notes:[note] };
assert.deepEqual(parseKnowledge(JSON.stringify(library)).notes[0].todos,[todo]);
assert.throws(() => parseKnowledge(JSON.stringify({ ...library,notes:[{...note,todos:[todo,todo]}] })),/待办/);

// Fixtures are synthetic. A receipt remains findable after its reminder closes.
const examples = [
  {id:'receipt',text:'索取测试记录',outcome:{at:time,text:'拿到了日志',purpose:'编写 Nimbus 发布手册',url:'https://example.test/test-log', projectId:'p1'}},
  {id:'old',text:'核对 Nimbus 支持清单',outcome:{at:time,text:'已收到盖章清单'}},
  {id:'third',text:'Nimbus 机密',outcome:{at:time,text:'另一项目',projectId:'p2'}},
  {id:'waiting',text:'Nimbus 价格表',outcome:{at:time,text:'仍在等待'},followup:{dueAt:time}},
  {id:'absent',text:'Nimbus 故障记录'},
  {id:'person',text:'请林钟岚发回记录',outcome:{at:time,text:'收到了'}},
  {id:'project-only',text:'问同事要材料',outcome:{at:time,text:'记录在这里',projectId:'p3'}},
].map(row => ({...todo,...row}));
const match = createMaterialRecall([{...note,todos:examples}], [{id:'p3',name:'Altair'}]);
const firstHits = match({text:'撰写 Nimbus 主打材料',projectId:'p1'});
assert.deepEqual(firstHits.map(x=>x.todoId), ['receipt','old']);
assert.deepEqual(match({text:'Nimbus',projectId:'p1',filedOnly:true}).map(m=>m.todoId), ['receipt']);
assert.deepEqual(match({text:'Nimbus',filedOnly:true}), []);
assert.equal(firstHits[0].url, 'https://example.test/test-log');
assert.match(firstHits[0].reason,/预留用途/);
assert.deepEqual(match({text:'整理材料'}), [], 'generic words alone never surface personal records');
assert.deepEqual(match({text:'整理资料',projectId:'p3'}).map(m=>m.todoId), ['project-only'], 'explicit project filing can supply materials for a generic material task within that project');
assert.deepEqual(match({text:'整理厨房资料',projectId:'p3'}), [], 'a conflicting topic is not sufficient');
assert.deepEqual(match({text:'准备 Altair 主打材料'}).map(m=>m.todoId), ['project-only'], 'a personal agenda can match by exact project name');
assert.deepEqual(match({text:'林钟岚反馈'}).map(m=>m.todoId), ['person']);
assert.deepEqual(match({text:'Nimbus',projectId:'p1',exclude:{noteId:note.id,todoId:'receipt'}}).map(m=>m.todoId), ['old']);
const filedQuote = {id:'quote',projectId:'p2',lineIndex:4,text:examples[1].text,at:time};
const filedMatch = createMaterialRecall([{...note,todos:[examples[1]],projectQuotes:[filedQuote]}]);
assert.deepEqual(filedMatch({text:'Nimbus',projectId:'p1'}), []);
assert.equal(filedMatch({text:'Nimbus',projectId:'p2'})[0]?.projectId, undefined, 'sharing a quote does not also share a later receipt');
assert.deepEqual(createMaterialRecall([{...note,todos:examples,archivedAt:time}])({text:'Nimbus'}), []);
assert.deepEqual(createMaterialRecall([{...note,todos:[{...examples[1],completedAt:undefined}]}])({text:'Nimbus'}), []);

async function concurrentUpdates() {
  // Simulate the desktop store changing after the first read but before compare-and-swap.
  let data = JSON.stringify({ ...library, notes:[{...note,todos:undefined}] });
  let writes = 0, resolved = 0;
  const windowStub = Object.assign(new EventTarget(), { quandeckDesktop: {
    async readKnowledge(){return data;},
    async resolveNoteTodoDue(text:string){ resolved++; return resolveNoteTodoDue(text,now); },
    async compareKnowledge(expected: string, next: string) {
      if (++writes === 1) {
        const parallel = parseKnowledge(data);
        parallel.notes[0].todos = [todo];
        data = JSON.stringify(parallel);
        return false;
      }
      if (expected !== data) return false;
      data=next;
      return true;
    }
  }});
  Object.defineProperty(globalThis,'window',{configurable:true,value:windowStub});
  const added = await addNoteTodo(note.id,2,note.body);
  const again = await addNoteTodo(note.id,2,note.body);
  assert.equal(again.id,added.id,'repeat clicks keep the original item');
  assert.equal(resolved,2);
  assert.deepEqual(parseKnowledge(data).notes[0].todos?.map(item=>item.id),[todo.id,added.id]);
  assert.equal(parseKnowledge(data).notes[0].revision,1,'metadata does not invalidate a dirty note draft');
  await setNoteTodoCompleted(note.id,added.id,true);
  const first = parseKnowledge(data).notes[0].todos![1].completedAt;
  assert.ok(first);
  await setNoteTodoCompleted(note.id,added.id,true);
  assert.equal(parseKnowledge(data).notes[0].todos![1].completedAt,first);
  await setNoteTodoCompleted(note.id,added.id,false);
  assert.equal(parseKnowledge(data).notes[0].todos![1].completedAt,undefined);
  assert.equal(parseKnowledge(data).notes[0].todos![0].completedAt,todo.completedAt);
  await Promise.all([
    addNoteTodoProgress(note.id, added.id, 'first', '  拿到样稿  '),
    addNoteTodoProgress(note.id, added.id, 'second', '已请同事核对'),
  ]);
  await addNoteTodoProgress(note.id, added.id, 'first', '拿到样稿');
  await assert.rejects(addNoteTodoProgress(note.id,added.id,'first','标题被替换'),/重新添加/);
  const recorded = parseKnowledge(data).notes[0];
  assert.deepEqual(recorded.todos![1].progress?.map(row => row.text), ['拿到样稿','已请同事核对']);
  assert(recorded.todos![1].progress?.every(row => Number.isFinite(Date.parse(row.at))));
  assert.equal(recorded.todos![0].progress,undefined);
  assert.deepEqual(updateNote(recorded,{title:recorded.title,body:'补充\n'+recorded.body},edit).todos![1].progress,recorded.todos![1].progress);
  const move = {dueAt:new Date(Date.now()+8*3600_000).toISOString(),expectedAt:Date.parse(added.dueAt)};
  await addNoteTodoProgress(note.id,added.id,'delay','改期',false,move);
  await addNoteTodoProgress(note.id,added.id,'delay','改期',false,move);
  assert.equal(parseKnowledge(data).notes[0].todos![1].dueAt,move.dueAt);
  await assert.rejects(addNoteTodoProgress(note.id,added.id,'stale','另一个窗口改期',false,move),/更新/);
  await saveNoteTodoOutcome(note.id, added.id, { text:'定稿',url:'',purpose:'Nimbus 手册', progress:{id:'closing',text:'已确认'} });
  assert.ok(parseKnowledge(data).notes[0].todos![1].completedAt);
  assert.equal(parseKnowledge(data).notes[0].todos![1].progress!.at(-1)?.id,'closing');
  const receiptAt = parseKnowledge(data).notes[0].todos![1].outcome!.at;
  await assert.rejects(assignTodoMaterial(note.id, added.id, 'stale', 'p1'), /刚有变化/);
  await assignTodoMaterial(note.id, added.id, receiptAt, 'p1');
  await assert.rejects(assignTodoMaterial(note.id, added.id, receiptAt, 'p2'), /其他项目/);
  await saveNoteTodoOutcome(note.id, added.id, { text:'定稿已复核', url:'' });
  assert.equal(parseKnowledge(data).notes[0].todos![1].outcome?.projectId,'p1','older callers keep filing');
  assert.equal(parseKnowledge(data).notes[0].todos![1].outcome?.purpose,'Nimbus 手册');
  await saveNoteTodoOutcome(note.id,added.id,{text:'定稿',url:'',projectId:'',purpose:''});
  assert.equal(parseKnowledge(data).notes[0].todos![1].outcome?.projectId,undefined);
  const beforeRemoval = parseKnowledge(data).notes[0];
  await removeNoteTodo(note.id, todo.id); // completed, same text as the second todo
  await removeNoteTodo(note.id, todo.id); // repeated requests are safe
  const restored = parseKnowledge(data).notes[0];
  assert.deepEqual(restored, {...beforeRemoval, todos: beforeRemoval.todos!.filter(item => item.id !== todo.id)});
  assert.equal(restored.todos![0].id, added.id);
  const readded = await addNoteTodo(note.id, todo.lineIndex, restored.body);
  assert.notEqual(readded.id, todo.id);
  assert.equal(readded.completedAt, undefined);
  await removeNoteTodo(note.id, todo.id); // a delayed request cannot remove the new item
  assert.ok(parseKnowledge(data).notes[0].todos?.some(item => item.id === readded.id));
  await assert.rejects(addNoteTodo(note.id,0,'旧正文'),/刚有改动/);
  await assert.rejects(addNoteTodo(note.id,1,note.body),/这行/);
}
concurrentUpdates().then(()=>console.log('Note todos: local dates, 8-hour fallback, row identity and racing desktop writes passed'));
