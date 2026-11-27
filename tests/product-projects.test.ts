import assert from 'node:assert/strict';
import { buildContextPackage, taskKey } from '../src/data/collaboration';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { dateDay, ganttColumns, planningTask, shiftPlannedTask } from '../src/data/projectPlanning';
import { readProjectAnalysis } from '../src/data/projectAnalysis';
import type { TaskDraft } from '../src/data/types';

const memory=new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
  getItem:(key:string)=>memory.get(key)??null,
  setItem:(key:string,value:string)=>memory.set(key,value),
  removeItem:(key:string)=>memory.delete(key),
}});

async function run() {
  let failure=true, writes=0;
  const cleaned:string[]=[];
  const source=new LocalWorkdeckDataSource({
    storeProjectFile:async(_projectId,file)=>{
      const id='file-'+(++writes);
      if(failure&&file.name==='第二份')throw Error('附件保存失败');
      return {id,name:file.name,type:file.type,size:file.bytes.byteLength};
    },
    removeProjectFile:async(_projectId,fileId)=>{cleaned.push(fileId);},
  });
  const old=await source.createProject({name:'已有项目'});
  const oldTask=await source.createTaskWithAttachments('既有任务',[],old.projectId!);
  const task=(key:string,parentKey?:string):TaskDraft=>({key,parentKey,title:key==='main'?'整理手册':'核对清单',
    expected:'与原标签一致',deps:[],owner:'unassigned',phase:'执行',lineIds:[],include:true});
  const understanding={summary:'用色标区分三类展品',sourceId:'synthetic-review',recommendations:[
    {id:'note:public-demo',kind:'笔记',title:'色标手记',quote:'蓝签代表借展',reason:'明确藏品归属',use:'为借展清单标注归属'},
  ],attachments:[{name:'第一份',status:'read' as const},{name:'第二份',status:'partial' as const}],
    questions:['未回答的问题示例'],tasks:[task('unconfirmed')]};
  const setup={name:'小型展览',description:'完成清单和纸本手册',deadline:'2026-12-18',ownerName:'小周',setup:{
    requestId:'2eb3b31a-7526-4cb9-8c3c-ef236a63217a',background:'编号来自标签',understanding,
    tasks:[task('child','main'),task('main')],
    files:[{name:'第一份',type:'text/plain',bytes:new ArrayBuffer(3)},{name:'第二份',type:'text/plain',bytes:new ArrayBuffer(4)}],
  }};
  assert.equal((await source.createProject({...setup,deadline:'2026-02-30'})).ok,false);
  const mismatch=await source.createProject({...setup,setup:{...setup.setup,files:[...setup.setup.files].reverse()}});
  assert.equal(mismatch.ok,false,'stale file analysis is refused before file writes');
  assert.equal(writes,0);
  assert.equal((await source.createProject(setup)).ok,false);
  assert.equal((await source.listProjects()).length,1);
  assert.deepEqual(cleaned,['file-1']);
  failure=false;
  const created=await source.createProject(setup);
  assert.ok(created.ok);
  assert.equal((await source.createProject(setup)).projectId,created.projectId);
  const restored = new LocalWorkdeckDataSource();
  assert.ok((await restored.createProject(structuredClone(setup))).ok,'unchanged creation is acknowledged after reload');
  const differentBytes = structuredClone(setup);
  new Uint8Array(differentBytes.setup.files[0].bytes)[0] = 1;
  for (const changed of [
    {...setup,workspacePath:'/different/source'},
    {...setup,setup:{...setup.setup,background:'新背景'}},
    {...setup,setup:{...setup.setup,tasks:[task('changed')]}},
    {...setup,setup:{...setup.setup,understanding:{...understanding,recommendations:[]}}},
    differentBytes,
  ]) {
    const refused=await restored.createProject(changed);
    assert.equal(refused.ok,false);
    assert.deepEqual(refused.conflictingProject,{id:created.projectId,name:setup.name});
  }
  assert.equal((await restored.listProjects()).length,2,'conflicting inputs do not duplicate or change the original');
  const storageKey='quandeck.projects.v1',stored=memory.get(storageKey)!;
  const legacy=JSON.parse(stored);
  delete legacy.projects[created.projectId!].project.creationFingerprint;
  memory.set(storageKey,JSON.stringify(legacy));
  const unverifiable=await new LocalWorkdeckDataSource().createProject(setup);
  assert.equal(unverifiable.ok,false);
  assert.equal(unverifiable.conflictingProject?.id,created.projectId,'old projects require an explicit choice');
  memory.set(storageKey,stored);
  assert.equal(writes,4,'replaying successful confirmation does not save duplicate files');
  assert.equal((await source.listProjects()).length,2);
  let current=await source.load();
  assert.equal(current.project.deadline,'2026-12-18');
  assert.equal(current.project.ownerName,'小周');
  assert.equal(current.project.attachments?.length,2);
  const savedReview = (await new LocalWorkdeckDataSource().load()).project.understanding!;
  assert.equal(savedReview.sourceId,'synthetic-review');
  assert.deepEqual(savedReview.recommendations, understanding.recommendations);
  assert.equal(savedReview.attachments?.[1].status,'partial');
  assert(!('questions' in savedReview || 'tasks' in savedReview),'proposed tasks/questions are not project requirements');
  assert.deepEqual(current.sessions,{});
  const [root]=Object.values(current.tasks);
  const [item]=Object.values(current.orchestrations![root.id].items);
  assert.equal(Object.keys(current.tasks).length,1,'create only the reviewed business tasks');
  assert.equal(item.parentTaskId,root.id);
  const taskId=root.id,itemId=item.id,key=taskKey(taskId,itemId);
  {
    const prompt=buildContextPackage(current,key).prompt;
    for (const value of ['完成清单和纸本手册','编号来自标签','用色标区分三类展品','蓝签代表借展','明确藏品归属','为借展清单标注归属','note:public-demo','partial']) assert(prompt.includes(value), value);
    assert.doesNotMatch(prompt,/未回答的问题示例|unconfirmed/);
    assert.equal(prompt.split('用色标区分三类展品').length,2);
    const legacy = structuredClone(current);
    delete legacy.project.understanding;
    assert.match(buildContextPackage(legacy,key).prompt, /编号来自标签/);
    assert.doesNotMatch(buildContextPackage(legacy,key).prompt, /AI 需求理解/);
  }
  const specRevision=current.collaboration!.tasks[key].specRevision;
  assert.ok((await source.updateProjectPlanning(current.project.id,{kind:'task',taskId,itemId,
    fields:{start:'2026-12-01',end:'2026-12-04',priority:'P1',information:'编号来自标签',conclusion:'逐件核对',deliverable:'编号表',researchSourceId:'example-only'},
    criteria:['与原标签一致'],expectedSpecRevision:specRevision,expectedRevision:0,
  })).ok);
  current=await source.load();
  assert.match(buildContextPackage(current,key).prompt,/逐件核对/);
  const earlierProject=(await source.listProjects()).find(row=>row.project.id===old.projectId)!;
  assert.doesNotMatch(buildContextPackage(earlierProject,taskKey(oldTask.taskId!)).prompt,/逐件核对|编号来自标签|用色标区分三类展品|蓝签代表借展/);
  assert.equal(current.projectPlanning?.changes?.length,1);
  assert.equal((await source.updateProjectPlanning(current.project.id,{kind:'task',taskId,itemId,fields:{start:'2026-12-05',end:'2026-12-04'},expectedRevision:1})).ok,false);
  assert.equal((await source.updateProjectPlanning(current.project.id,{kind:'task',taskId,itemId,fields:{},expectedRevision:0})).ok,false);
  assert.equal(planningTask(current,taskId,itemId).priority,'P1');
  assert.deepEqual(shiftPlannedTask(planningTask(current,taskId,itemId),3,'move').end,'2026-12-07');
  assert.equal(ganttColumns(dateDay('2026-12-08')!,'month')[0].end-ganttColumns(dateDay('2026-12-08')!,'month')[0].start,31);
  assert.equal((await source.listProjects()).find(row=>row.project.id===old.projectId)!.tasks[oldTask.taskId!].title,'既有任务');
  assert.deepEqual(readProjectAnalysis({summary:'来自原文',questions:[],tasks:[{...task('main'),parentKey:''}]},'synthetic-analysis',false).tasks.map(task=>task.key),['main']);
  assert.deepEqual(readProjectAnalysis({summary:'来自原文',questions:[],tasks:[task('main')]},'synthetic-analysis',true).tasks,[]);
  assert.throws(()=>readProjectAnalysis({summary:'没有回执',questions:[],tasks:[]},'',true));
  console.log('Product projects: creation validates first, rolls back attachment failure, confirmation replays safely, task IDs remain stable, scheduling and research context stay scoped.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
