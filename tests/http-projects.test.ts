import assert from 'node:assert/strict';
import { createHttpDataSource } from '../src/data/httpRepository';
import { createEmptySnapshot } from '../src/data/projectStorage';
const a = createEmptySnapshot({id:'a',name:'A'}), b = createEmptySnapshot({id:'b',name:'B'});
let completeOld: ((response: Response) => void) | undefined;
let seen: any;
globalThis.fetch = async (input, init) => {
  const url=String(input);
  if(url.endsWith('/projects'))return Response.json({projects:[a,b]});
  if(url.endsWith('/snapshot'))return Response.json({revision:10,snapshot:a});
  if(url.endsWith('/commands/updateTaskTitle')){seen=JSON.parse(init!.body as string);return new Promise<Response>(resolve=>{completeOld=resolve;});}
  if(url.endsWith('/commands/deleteProject')) { seen=JSON.parse(init!.body as string); return Response.json({revision:0,snapshot:createEmptySnapshot(),result:{ok:true}}); }
  if(url.endsWith('/commands/switchProject'))return Response.json({revision:1,snapshot:b,result:{ok:true}});
  throw new Error(url);
};
(async()=>{
  const source=createHttpDataSource('https://api.example');
  assert.equal((await source.listProjects()).length,2);
  await source.load();
  const observed:string[]=[];
  // No EventSource needed: inspect snapshots through mocked load after commands by subscription stub.
  (globalThis as any).EventSource=class {addEventListener(){} close(){}};
  const off=source.subscribe(s=>observed.push(s.project.id));
  const old=source.updateTaskTitle('task-a','new title');
  assert.equal(seen.projectId,'a');assert.equal(seen.expectedRevision,10);
  await source.switchProject('b');
  assert.deepEqual(observed,['b'],'project B can start at a lower revision than project A');
  completeOld!(Response.json({revision:11,snapshot:a,result:{ok:true}}));await old;
  assert.deepEqual(observed,['b'],'old project command cannot replace the selected project');
  await source.deleteProject('b'); assert.equal(seen.args[0],'b'); assert.deepEqual(observed,['b',''],'deleting the active project can transition to the empty workspace');
  off();console.log('HTTP projects: explicit command project identity, independent revision on switch, stale command isolation');
})().catch(error=>{console.error(error);process.exitCode=1;});
