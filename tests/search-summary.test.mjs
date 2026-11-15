/** Run from any working directory: node tests/search-summary.test.mjs. No browser or service needed. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const build = mkdtempSync(join(tmpdir(), "quandeck-search-summary-tests-"));
const originalFetchBeforeSuite = globalThis.fetch;
try {
  execFileSync(process.execPath, [
    require.resolve("typescript/bin/tsc"),
    "src/data/search.ts", "src/data/projectActivity.ts", "src/data/fixtures.ts",
    "--rootDir", "src", "--outDir", build,
    "--module", "commonjs", "--target", "ES2020", "--moduleResolution", "node",
    "--skipLibCheck", "--esModuleInterop", "--strict",
  ], { cwd: project, stdio: "inherit" });
  writeFileSync(join(build, "package.json"), JSON.stringify({ type: "commonjs" }));
  const { createSampleSnapshot } = require(join(build, "data/fixtures.js"));
  const { searchSnapshot, SearchRequestGate, createHttpSearchBackend } = require(join(build, "data/search.js"));
  const { deriveProjectActivity } = require(join(build, "data/projectActivity.js"));
const cases = [];
function check(name, run) { run(); cases.push(name); }
async function main() {
const s = createSampleSnapshot();
const run = q => searchSnapshot(s, {projectId:s.project.id, query:q});
check('Chinese gapped keywords match title', () => assert(run('读书搜索').items.some(x => x.target.taskId === 'task-a')));
check('Chinese single typo retrieves title', () => assert(run('全文搜所').items.some(x => x.target.taskId === 'task-a')));
check('English transposition matches reply content', () => assert(run('tokenzier').items.some(x => x.kind === 'work')));
check('AND terms match body and title', () => assert(run('搜索 高亮').items.some(x => x.kind === 'work')));
check('wrong project isolated', () => assert.equal(searchSnapshot(s, {projectId:'another',query:'搜索'}).total,0));
check('empty punctuation query has no results', () => assert.equal(run('!?').total,0));
check('kind filter respected', () => assert(run('搜索').items.length > 0 && searchSnapshot(s,{projectId:s.project.id, query:'搜索', kinds:['work']}).items.every(x=>x.kind==='work')));
check('journal body is indexed with exact block', () => {s.journal.blocks.push({id:'privacy-test',kind:'text',text:'摄影计划：傍晚乘坐渡轮，拍海上日落。'}); assert(run('海上日落').items.some(x => x.target.blockId==='privacy-test'));});
check('long journal paragraphs searchable beyond initial excerpt', () => {s.journal.blocks.push({id:'long-body',kind:'text',text:'前文'.repeat(2000)+'芭提雅日落晚餐'}); assert(run('芭提亚日落').items.some(x => x.target.blockId==='long-body'));s.journal.blocks=s.journal.blocks.filter(x=>x.id!=='long-body');});
check('updates and deletes reindex without stale hits', () => {s.journal.blocks = s.journal.blocks.filter(x=>x.id!=='privacy-test'); assert(!run('海上日落').items.some(x => x.target.blockId==='privacy-test'));});
check('pagination stable', () => {const first=searchSnapshot(s,{projectId:s.project.id,query:'搜索',limit:2}); const second=searchSnapshot(s,{projectId:s.project.id,query:'搜索',limit:2,cursor:first.nextCursor}); assert(first.nextCursor); assert(!second.items.some(x => first.items.some(y => y.id===x.id)));});
check('no long-term quadratic query slowdown', () => {const started=performance.now(); run('没有找到的芭提雅行程方案'); assert(performance.now()-started < 1500);});
const totals=deriveProjectActivity(s);
check('all source sessions count once', () => {const ids=totals.entries.filter(x=>x.sessionId).map(x=>`${x.agentId}:${x.sessionId}`); assert.equal(ids.length,new Set(ids).size);});
check('root rollup excluded with child execution', () => assert(!totals.entries.some(x => x.id==='session:ses-claude-search')));
check('standalone execution included', () => assert(totals.entries.some(x => !x.itemId)));
const orch=s.orchestrations['task-a'];
const activeItem=Object.values(orch.items).find(x=>x.status==='running');
const before=deriveProjectActivity(s).counts.running;
activeItem.status='queued';
check('queued is not counted as running', () => { const x=deriveProjectActivity(s); assert.equal(x.counts.running,before-1); assert(x.counts.queued>=1); });
activeItem.owner='me';
check('manual work excluded from Agent counts', () => assert(!deriveProjectActivity(s).entries.some(x=>x.itemId===activeItem.id)));
const waitingItem=Object.values(orch.items).find(x=>x.status==='waiting_reply');
assert(waitingItem, 'fixture includes a waiting-reply work item');
waitingItem.status='waiting_permission'; check('permission distinct from reply',()=>{const x=deriveProjectActivity(s);assert(x.counts.waitingPermission>0);});
const isolated=createSampleSnapshot();isolated.orchestrations={};
const template=Object.values(isolated.sessions).find(x=>x.status==='running');
isolated.sessions={a:{...template,id:'a',subAgents:[],status:'pending',dispatchPhase:'acknowledged'}};
check('acknowledged pending counts as queued',()=>{const c=deriveProjectActivity(isolated).counts;assert.equal(c.queued,1);assert.equal(c.running,0)});
isolated.sessions.a.dispatchPhase='submitting';check('unacknowledged dispatch not counted running or queued',()=>assert.equal(deriveProjectActivity(isolated).entries.length,0));
const source={connectionId:'device-a',tool:'codex',sessionId:'runtime-id'};
isolated.sessions={a:{...template,id:'a',subAgents:[],source},b:{...template,id:'b',subAgents:[],source:{...source,connectionId:'device-b'}}};
check('same runtime ID on two connections counts separately',()=>assert.equal(deriveProjectActivity(isolated).counts.running,2));
isolated.sessions.b.source=source;check('same runtime session via two business records deduplicates',()=>assert.equal(deriveProjectActivity(isolated).counts.running,1));
isolated.sessions.a.source={...source,childCallId:'call-a'};isolated.sessions.b.source={...source,childCallId:'call-b'};
check('embedded child call identities remain distinct',()=>assert.equal(deriveProjectActivity(isolated).counts.running,2));
isolated.sessions={a:{...template,id:'history',linkedAsHistory:true,subAgents:[{id:'history-child',title:'旧子代理',status:'running',start:'09:00',tokens:1,sessionRef:'historic-session'}]}};
check('history links excluded including historical child records',()=>assert.equal(deriveProjectActivity(isolated).entries.length,0));
const gate=new SearchRequestGate(); let resolveOld; let resolveNew;
const provider={search(req){return new Promise(resolve=>req.query==='old'?resolveOld=resolve:resolveNew=resolve)}};
const old=gate.run(provider,{projectId:'p',query:'old'}); const newer=gate.run(provider,{projectId:'p',query:'new'});
resolveNew({items:['new']}); assert.deepEqual(await newer,{items:['new']});resolveOld({items:['old']});assert.equal(await old,null);cases.push('older slow response cannot overwrite newest');
const cancelled=gate.run(provider,{projectId:'p',query:'old'});gate.cancel();resolveOld({items:['old']});assert.equal(await cancelled,null);cases.push('closed popup cancels unresolved search');
const originalFetch=global.fetch;let requested;
global.fetch=async(url,options)=>{requested={url:String(url),options};return {ok:true,json:async()=>({items:[],total:0,scope:'project_index',indexedAt:'now'})}};
await createHttpSearchBackend('http://localhost:9876').search({projectId:'项目',query:'hello world',limit:7},{signal:new AbortController().signal});
assert.equal(requested.options.credentials, 'include');assert(requested.options.signal instanceof AbortSignal);assert(requested.url.includes('/v1/search?'));assert.equal(new URL(requested.url).searchParams.get('q'),'hello world');assert.equal(new URL(requested.url).searchParams.get('projectId'),'项目');cases.push('HTTP encoded contract and signal');
global.fetch=async()=>({ok:true,json:async()=>({items:[{id:'bad'}]})});await assert.rejects(()=>createHttpSearchBackend('http://localhost').search({projectId:'p',query:'q'}),/格式/);cases.push('malformed backend response rejected');
global.fetch=async()=>({ok:false,status:503});await assert.rejects(()=>createHttpSearchBackend('http://localhost').search({projectId:'p',query:'q'}),/503/);cases.push('backend error surfaced without local fallback');
global.fetch=originalFetch;
const report={passed:cases.length,cases,baselineCounts:totals.counts};console.log(JSON.stringify(report,null,2));
}
await main();

} finally {
  globalThis.fetch = originalFetchBeforeSuite;
  rmSync(build, { recursive: true, force: true });
}
