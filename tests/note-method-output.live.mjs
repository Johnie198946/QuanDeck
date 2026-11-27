// Opt-in real Agent acceptance. Runs only synthetic notes in temporary empty projects.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { createRuntimeDriver } from '../scripts/runtime/driver.mjs';
import { commandInvocation } from '../scripts/agent-bridge.mjs';

const output = path.resolve(process.env.QUANDECK_UI_OUTPUT || 'output/note-method');
await mkdir(output,{recursive:true});
await build({configFile:false,publicDir:false,logLevel:'warn',build:{target:'node22',outDir:output,emptyOutDir:false,
  lib:{entry:'tests/note-method-output.fixture.ts',formats:['es'],fileName:()=>'method-api.mjs'}}});
const {LocalWorkdeckDataSource,createRuntimeDataSource,sendNoteDispatch,makeSelection,noteSelectionTaskKey,projectNoteReceipts,noteLogicGroups}
  = await import(pathToFileURL(path.join(output,'method-api.mjs')));
const facts='归程预算150元。青禾线120元，需换乘3次；雾凇线160元，无需换乘。选一条路线，算出预算余额，超支用负数。';
const notes = [{id:'routes',title:'返程备选',body:facts,createdAt:new Date().toISOString(),revision:1,updatedAt:new Date().toISOString(),
  attachments:[],expansions:[],history:[]}];
const cases = [
  {name:'预算优先',method:'先剔除超过预算的路线，再选换乘最少的一条。',
    tags:['严格按 海鸥|路线名称|票价数字|余额数字 写一行。不要单位、表格、解释。'],expected:'海鸥|青禾线|120|30'},
  {name:'换乘优先',method:'先剔除换乘超过一次的路线。允许适度超支，在剩余路线中选票价最低的一条。',tags:[]},
];
for (const sample of cases) {
  const storage=new Map();
  globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  const projectPath=await mkdtemp(path.join(tmpdir(),'qd-method-check-'));
  const connection={connectionId:'synthetic',tool:'codex',binary:process.env.QUANDECK_CODEX_BINARY || 'codex',
    ...(process.env.QUANDECK_AGENT_MODEL && {model:process.env.QUANDECK_AGENT_MODEL}),projectPath};
  const driver=createRuntimeDriver({getConnection:id=>id===connection.connectionId?connection:undefined,commandInvocation});
  const base=new LocalWorkdeckDataSource();
  const api=createRuntimeDataSource(base,driver);
  const started=Date.now();
  try {
    const project=await api.createProject({name:sample.name});
    assert.ok(project.ok,project.message);
    await api.registerAgent({id:'codex',name:'Codex',short:'C',color:'#315e9a'});
    const bound=await api.bindRuntimeConnection('codex',{connectionId:connection.connectionId,tool:'codex',projectPath,
      capabilities:{observe:true,dispatch:true,resume:true,usage:true,subAgents:true,sourceOpen:true,permissions:true}});
    assert.ok(bound.ok,bound.message);
    const library={schema:1,notes,decisions:[],inspirationCanvas:{nodes:[
      {noteId:'filter',x:0,y:0,idea:{title:'筛选',detail:sample.method,origin:'manual'}},
      {noteId:'decision',x:200,y:0,idea:{title:'选定路线',detail:'计算该路线的预算余额。',origin:'manual'}}],
      links:[{id:'edge',from:'filter',to:'decision',label:'接着',detail:'先筛后选',reverseDetail:''}]}};
    const [group]=noteLogicGroups(library);
    const source={noteId:notes[0].id,lineIndex:0,selection:makeSelection(facts,0,facts.length)};
    const sent=await sendNoteDispatch(api,{projectId:project.projectId,text:facts,origin:{title:notes[0].title,key:noteSelectionTaskKey(source,facts),
      noteSource:source,dispatch:{agentId:'codex',logic:group.steps,customTags:sample.tags}}});
    assert.ok(sent.ok,sent.message);
    let result;
    while(Date.now()-started<150_000) {
      const [snapshot]=await api.listProjects();
      const receipt=projectNoteReceipts([snapshot],notes).get(source.noteId)?.flatMap(row=>row.receipts).find(row=>row.kind==='成果');
      if (receipt) {
        const body=snapshot.collaboration.artifacts.find(artifact=>'output:'+artifact.id===receipt.resultId || artifact.id===receipt.resultId)?.body;
        result=body || receipt.text;
        break;
      }
      const run=driver.listRuns()[0];
      assert.ok(!['failed','waiting_permission'].includes(run?.status),'Agent status: '+run?.status+' '+(run?.error||''));
      await new Promise(done=>setTimeout(done,250));
    }
    assert.ok(result,'未收到原笔记的成果回执');
    console.log(JSON.stringify({case:sample.name,elapsedMs:Date.now()-started,result}));
    await writeFile(path.join(output,sample.name+'.json'),JSON.stringify({case:sample.name,facts,method:sample.method,userTags:sample.tags,result},null,2));
    if (sample.expected) assert.equal(result.trim().replace(/[ \t]/gu,'').replace(/｜/gu,'|'),sample.expected);
    else {
      assert.match(result,/雾凇/);
      assert.match(result,/[−－-]\s*10|负\s*(?:10|十)/);
      assert.doesNotMatch(result,/海鸥/);
    }
  } finally { api.dispose();await driver.close(); }
}
