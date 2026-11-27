import assert from 'node:assert/strict';
import { progressTimeIntent, progressReschedule } from '../src/data/scheduleProgress';

const written = new Date(2026,10,28,0,11); // Saturday; use local calendar dates on every platform.
const original = +new Date(2026,10,30,17,45);
const iso = (day:number, hour:number, minute=0) => new Date(2026,10,day,hour,minute).toISOString();
const interpret = (text:string) => progressTimeIntent(text,written,original);

for (const [text, dueAt] of [
  ['从原来的周一下午五点挪到周二中午十二点',iso(31,12)],
  ['原来打算周二交，现在定在周四下班前',iso(33,18)],
  ['改到周一，下午三点交',iso(30,15)],
  ['改到周一，不对，改到周三十点',iso(32,10)],
  ['改期到周三，更正一下：周二18:20',iso(31,18,20)],
  ['延期一个半小时',iso(30,19,15)],
  ['往前提十五分钟',iso(30,17,30)],
  ['改到两小时后',new Date(+written+2*3600_000).toISOString()],
  ['时间调到下午三点',iso(30,15)],
  ['改到3 PM',iso(30,15)],
  ['今天不能完成，改到下周一下午3点',iso(30,15)],
  ['调整为星期二',iso(31,17,45)],
  ['改到星期一凌晨12点',iso(30,0)],
  ['改到星期一中午十二点',iso(30,12)],
  ['改到星期一晚上12点',iso(31,0)],
  ['截止时间设为明天18:20',iso(29,18,20)],
  ['改到2026-12-15（周二）18:00',iso(45,18)],
  ['改到11月30日（星期一）十点',iso(30,10)],
] as const) assert.deepEqual(interpret(text),{kind:'move',dueAt},text);

for (const text of ['不能改到周一','无法改到周一','不可以把截止时间改到周一','对方改到周二，我自己的任务不变','改到周一，但这个时间还没确认',"Can’t 改到周一",'别改到周一','问他是否可以改到周一','已催过，明天再跟进','封面改成绿色','把标题改成周一中午交稿','提前准备明天的会','对方说改到周二','如果设备晚到就延后两天','原计划改到周三','不用改期了','改到周二，按原时间执行','改期到明天下午再联系','前台来电确认可提前寄存行李','下个版本会提交','等对方，明天下午五点交稿','小王周一中午交','昨天下午五点交稿','周一中午已交稿','明天下午五点他提交','周一再确认是否提交'])
  assert.equal(interpret(text).kind,'none',text);

for (const text of ['改到下个月下午三点','改到春节后下午3点','改到下周下午3点','改到评审结束后下午三点','改到 next Monday 3 PM','改到3 PM next Tuesday','改期到15月90日','改到明天25:90','改到周一上午9点至11点','改到周一或周二','改到待定日期','改到周一，改到周三','延期两天半','改到昨天上午九点','改成11月30日星期二中午12点','调到明天后天','我要提前','这项延期']) {
  assert.equal(interpret(text).kind,'clarify',text);
  assert.equal(progressReschedule(text,written,original),undefined,text);
}
for (const text of ['改到星期一早上12点','改到礼拜一上午十二点半']) {
  const inferred = interpret(text);
  assert.equal(inferred.kind,'clarify',text);
  assert(inferred.kind === 'clarify');
  const minutes = text.endsWith('半') ? 30 : 0;
  assert.deepEqual(inferred.choices.map(c=>c.dueAt),[iso(30,12,minutes),iso(30,0,minutes)],text);
}
for (const [text, expected] of [
  ['今天来不及，明天下午五点交稿',iso(29,17)],
  ['我周一中午交',iso(30,12)],
] as const) {
  const result = interpret(text);
  assert(result.kind === 'clarify' && result.choices[0]?.dueAt === expected,text);
}
const alternativeDays = interpret('改到周一或周二');
assert(alternativeDays.kind === 'clarify');
assert.deepEqual(alternativeDays.choices.map(c=>c.dueAt),[iso(30,17,45),iso(31,17,45)]);
console.log('Schedule progress intent: local weekdays, deadlines, self-corrections, ambiguous clocks, invalid dates, durations and reporting-only updates passed.');
