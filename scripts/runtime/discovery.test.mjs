import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { scanDshSessions, scanCodexSessions } from './discovery.mjs';
test('managed Codex histories are not fetched during external discovery; independent sessions remain visible',async()=>{
 const now=Date.now(), reads=[];
 const rpc={call:async(method,input)=>{
   if(method==='thread/list')return {data:['managed','external'].map(id=>({id,cwd:'/work',createdAt:now/1000-60,updatedAt:now/1000})),nextCursor:null};
   reads.push(input.threadId); return {thread:{id:input.threadId,status:{type:'notLoaded'},updatedAt:now/1000,turns:[]}};
 }};
 const result=await scanCodexSessions({connectionId:'c',projectPath:'/work'},rpc,{now,managedSessionIds:new Set(['managed'])});
 assert.deepEqual(reads,['external']);assert.deepEqual(result.sessions.map(s=>s.sessionId),['external']);
});
test('DSH actual files: latest canonical zstd generation, project scope, final reply only and no reasoning',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'qd-discovery-')),now=Date.now();
 const log=(id,cwd)=>[
 {type:'session',version:3,id,cwd,createdAt:now-60000},
 {type:'user/message',seq:1,time:now-50000,data:{content:[{type:'text',text:'编排旅行'}]}},
 {type:'assistant/message',seq:2,time:now-40000,data:{message:{content:[{type:'reasoning',text:'private'},{type:'text',text:'中途'}]},usage:{inputTokens:5,outputTokens:1}}},
 {type:'assistant/message',seq:3,time:now-30000,data:{message:{content:[{type:'text',text:'最终结论'}]},usage:{inputTokens:6,outputTokens:2}}},
 {type:'turn/end',seq:4,time:now-20000,data:{reason:{kind:'completed'}}},
 ].map(x=>JSON.stringify(x)).join('\n')+'\n';
 try{
 for(const [id,cwd]of [['one','/work/mine'],['other','/work/other']]){const dir=path.join(root,'project',id);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'session.v3.jsonl.zstd'),zstdCompressSync(log(id,cwd)));await writeFile(path.join(dir,'session.jsonl'),'old\n');}
 const result=await scanDshSessions({connectionId:'c',projectPath:'/work/mine'},{root,now});assert.equal(result.sessions.length,1);const s=result.sessions[0];assert.equal(s.title,'编排旅行');assert.equal(s.tokens,14);assert.equal(s.status,'waiting_reply');assert.deepEqual(s.replies.map(r=>r.text),['最终结论']);assert.equal(JSON.stringify(result).includes('private'),false);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Codex discovery reads metadata+turns without starting or resuming a turn',async()=>{
 const now=Date.now(),calls=[];const rpc={call:async(method,params)=>{calls.push([method,params]);if(method==='thread/list')return{data:[{id:'mine',cwd:'/work',createdAt:now/1000-60,updatedAt:now/1000},{id:'foreign',cwd:'/other',updatedAt:now/1000}],nextCursor:null};if(method==='thread/read')return{thread:{name:'实际任务',status:{type:'notLoaded'},updatedAt:now/1000,turns:[{status:'completed',completedAt:now/1000,items:[{type:'reasoning',text:'private'},{type:'agentMessage',id:'middle',text:'中间'},{type:'agentMessage',id:'last',text:'最终'}]}]}};throw new Error('unexpected RPC');}};
 const result=await scanCodexSessions({connectionId:'c',projectPath:'/work'},rpc,{now});assert.equal(result.sessions.length,1);assert.equal(result.sessions[0].sessionId,'mine');assert.deepEqual(result.sessions[0].replies.map(r=>r.text),['最终']);assert.deepEqual(calls.map(x=>x[0]),['thread/list','thread/read']);assert.equal(calls[0][1].cwd,'/work');
});
