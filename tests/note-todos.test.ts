import assert from 'node:assert/strict';
import { resolveNoteTodoDue } from '../src/data/noteTodoDue';
import { addNoteTodo, addNoteTodoProgress, removeNoteTodo, setNoteTodoCompleted } from '../src/data/knowledgeStore';
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
