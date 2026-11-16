/** Native acceptance uses isolated installer data and manual artifacts, never a real Agent. */
export async function checkGoalDelivery(core, store, webContents) {
  const check = (ok, message) => { if (!ok) throw new Error('Goal delivery smoke: ' + message); };
  const wait = async (predicate, label) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Goal delivery smoke timed out: ' + label);
  };
  const created = await core.createProject({name:'安装验证 · 自动交付地图',description:'按路线和酒店两项交付，未完成内容保持空位。'});
  check(created.ok, 'create project');
  const projectId = created.projectId;
  const identity = await core.registerAgent({id:'native-goal-fixture',name:'隔离安装验收身份（未连接）',short:'测',color:'#667788'});
  check(identity.ok, 'register offline test identity');
  const planId = await core.ensureProjectPlan(projectId);
  check(await core.ensureProjectPlan(projectId) === planId, 'project direction identity is idempotent');
  let snapshot = await core.load();
  check(Object.keys(snapshot.tasks).length === 0, 'project direction creates no business task');
  const tasks = ['routes','hotel'].map(key => ({key,title:key==='routes'?'核对交通路线':'核对酒店',expected:'提供有来源的说明',owner:'me',phase:'核查',deps:[]}));
  const outline = [{id:'route-outline',title:'先核对路线，再确认酒店',kind:'body',lines:[{id:'route-logic',text:'路线独立核查；酒店尚未确定时保留待补空位。两项均回写交付地图。',state:'fixed'}]}];
  const conclusion = await core.recordDiscussionConclusion(planId,'root',{summary:'分别交付路线与酒店。',confirmed:[],open:[],tasks,outline,deliverables:[{id:'route-slot',title:'交通路线',taskKey:'routes'},{id:'hotel-slot',title:'住宿安排',taskKey:'hotel'}]});
  check(conclusion.ok, 'record direction: ' + conclusion.message);
  snapshot=await core.load();
  const latest = snapshot.ideaPlans[planId].discussion.conclusions.at(-1);
  const approved = await core.approvePlan(planId, latest.id, projectId, snapshot.ideaPlans[planId].draftVersion);
  check(approved.ok, 'approve direction');
  snapshot=await core.load();
  const program=snapshot.collaboration.goalPlans[planId].at(-1);
  check(program.slots.length===2 && program.tasks.length===2 && Object.keys(snapshot.tasks).length===2, 'two real tasks and declared slots');
  const route=program.slots.find(slot=>slot.title==='交通路线');
  const hotel=program.slots.find(slot=>slot.title==='住宿安排');
  check(route && hotel, 'declared slot identities');
  const receipt=await core.collaborate({projectId,type:'submit',taskId:route.taskId,idempotencyKey:'native-goal-route',expectedVersion:snapshot.collaboration.tasks[route.taskKey].version,payload:{title:'交通路线候选',body:'这是隔离安装验收的人工候选路线，等待核对。',sourceIds:[],unresolved:['候选未人工认可'],nextSteps:[],deliverySlotIds:[route.id]}});
  check(receipt.ok, 'submit one slot');
  const persisted=store.read('quandeck.projects.v1').projects[projectId];
  check(persisted.collaboration.goalPlans[planId].at(-1).slots.length===2, 'slot definitions persisted');
  check(persisted.ideaPlans[planId].adopted.doc.sections.some(section=>section.id==='route-outline'), 'outline persisted in approved version');
  await webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='任务')?.click()`);
  await wait(()=>webContents.executeJavaScript(`!!document.querySelector('.qd-journal') && document.body.innerText.includes('安装验证 · 自动交付地图')`),'project workspace');
  await webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='项目方向')?.click()`);
  await wait(()=>webContents.executeJavaScript(`!!document.querySelector('.qd-direction-doc[data-plan-id=${JSON.stringify(planId)}]') && document.querySelector('.qd-direction-body')?.textContent.includes('路线独立核查')`),'project direction body');
  await webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('quandeck:show-results'))`);
  await wait(()=>webContents.executeJavaScript(`!!document.querySelector('button[data-delivery-slot=${JSON.stringify(route.id)}][data-state="candidate"]') && !!document.querySelector('button[data-delivery-slot=${JSON.stringify(hotel.id)}][data-state="empty"]')`),'partial delivery map');
  await webContents.executeJavaScript(`document.querySelector('button[data-delivery-slot=${JSON.stringify(route.id)}]')?.click()`);
  await wait(()=>webContents.executeJavaScript(`document.body.innerText.includes('这是隔离安装验收的人工候选路线')`),'candidate detail');
  const snapshotAfter=await core.load();
  check(!Object.keys(snapshotAfter.sessions).length && !Object.keys(snapshotAfter.collaboration.runs).length, 'no fake AI runs');
  check(!snapshotAfter.collaboration.tasks[route.taskKey].acceptedArtifactId, 'assembly does not invent human approval');
  return {ok:true,projectDirection:true,outlinePersisted:true,noSyntheticTask:true,declaredSlots:2,partialAssembly:true,candidateNotAccepted:true,rendered:true};
}
