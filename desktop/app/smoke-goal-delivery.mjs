/** Uses the production commands in isolated installer data; never starts an Agent. */
export async function checkGoalDeliveryData(core, store) {
  const check = (ok, message) => { if (!ok) throw new Error('Goal delivery smoke: ' + message); };
  const created = await core.createProject({name:'安装验证 · 自动交付地图',description:'按路线和酒店两项贡献，逐件整合项目输出，未完成内容保持空位。'});
  check(created.ok, 'create project');
  const projectId = created.projectId;
  const identity=await core.registerAgent({id:'native-goal-fixture',name:'隔离安装验收身份（未连接）',short:'测',color:'#667788'});
  check(identity.ok, 'register offline test identity');
  const planId = await core.ensureProjectPlan(projectId);
  check(await core.ensureProjectPlan(projectId) === planId, 'project direction identity is idempotent');
  let snapshot = await core.load();
  check(Object.keys(snapshot.tasks).length === 0, 'project direction creates no business task');
  const tasks = ['routes','hotel'].map(key => ({key,title:key==='routes'?'核对交通路线':'核对酒店',expected:'提供有来源的说明',owner:'me',phase:'核查',deps:[]}));
  const outline = [{id:'route-outline',title:'先核对路线，再确认酒店',kind:'body',lines:[{id:'route-logic',text:'路线独立核查；酒店尚未确定时保留待补空位。两项均回写交付地图。',state:'fixed'}]}];
  const conclusion = await core.recordDiscussionConclusion(planId,'root',{summary:'分别交付路线、路线来源与酒店。',confirmed:[],open:[],tasks,outline,deliverables:[{id:'route-slot',title:'交通路线',taskKey:'routes'},{id:'source-slot',title:'路线来源',taskKey:'routes'},{id:'hotel-slot',title:'住宿安排',taskKey:'hotel'}]});
  check(conclusion.ok, 'record direction: ' + conclusion.message);
  snapshot=await core.load();
  const latest = snapshot.ideaPlans[planId].discussion.conclusions.at(-1);
  const approved = await core.approvePlan(planId, latest.id, projectId, snapshot.ideaPlans[planId].draftVersion);
  check(approved.ok, 'approve direction');
  snapshot=await core.load();
  const program=snapshot.collaboration.goalPlans[planId].at(-1);
  const contributions=program.tasks.filter(binding=>!binding.assembly), assemblies=program.tasks.filter(binding=>binding.assembly);
  check(program.contractSchema===1 && program.slots.length===3 && contributions.length===2 && assemblies.length===3 && Object.keys(snapshot.tasks).length===5, 'two contribution tasks and three backend-created final responsibilities');
  const route=program.slots.find(slot=>slot.title==='交通路线'), source=program.slots.find(slot=>slot.title==='路线来源'), hotel=program.slots.find(slot=>slot.title==='住宿安排');
  check(route && source && hotel && new Set(program.slots.map(slot=>slot.taskKey)).size===3, 'each final output has a distinct assembly responsibility');
  const slotsFor = (state,key) => Object.values(state.collaboration.goalPlans).flatMap(versions=>versions.at(-1).slots).filter(slot=>!slot.retired&&slot.taskKey===key);
  const contributionSlots=Object.values(snapshot.collaboration.goalPlans).flatMap(versions=>versions.at(-1).scope==='task'?versions.at(-1).slots:[]);
  const routeInput=contributionSlots.find(slot=>slot.id===route.contributionIds[0]), sourceInput=contributionSlots.find(slot=>slot.id===source.contributionIds[0]);
  check(routeInput && sourceInput && routeInput.taskKey===sourceInput.taskKey && routeInput.taskKey!==route.taskKey, 'two task items contribute to separate project outputs');
  for(const binding of assemblies) check(snapshot.collaboration.tasks[binding.key].dependencies.length===1 && !snapshot.collaboration.tasks[binding.key].dependencies.includes(binding.key), 'assembly has an explicit non-cyclic dependency');
  let serial=0;
  const command=async (type,slot,payload)=>{
    const state=await core.load();
    return core.collaborate({projectId,type,taskId:slot.taskId,workItemId:slot.workItemId,idempotencyKey:`native-goal-${++serial}`,expectedVersion:state.collaboration.tasks[slot.taskKey].version,payload});
  };
  const item=(slot,body)=>({slotId:slot.id,contractRevision:slot.contract.revision,body});
  const submit=async (slot,deliveryItems,sourceIds=[],unresolved=[])=>{
    const result=await command('submit',slot,{title:slot.title,body:'这是隔离安装验收的人工候选路线，等待核对。',sourceIds,unresolved,nextSteps:[],deliveryItems});
    check(result.ok, `submit ${slot.title}: ${result.message}`);return result;
  };
  const noFinalReceipts = state => !state.collaboration.artifacts.some(artifact=>artifact.deliveryReceipts?.some(receipt=>program.slots.some(slot=>slot.id===receipt.slotId)));
  await submit(routeInput,[],[],['路线来源尚未核对']);
  snapshot=await core.load();
  check(snapshot.collaboration.tasks[routeInput.taskKey].status==='paused' && noFinalReceipts(snapshot), 'empty contribution cannot fill a final slot');
  const partial=await submit(routeInput,[item(routeInput,'仅路线正文，尚未提供独立来源。')]);
  snapshot=await core.load();
  check(snapshot.collaboration.tasks[routeInput.taskKey].status==='paused' && noFinalReceipts(snapshot), 'one of two required task items remains incomplete');
  const taskSpec=snapshot.collaboration.specs.find(spec=>spec.key===routeInput.taskKey&&spec.revision===snapshot.collaboration.tasks[routeInput.taskKey].specRevision);
  const incompleteReview=await command('review',routeInput,{submissionId:partial.resourceId,verdict:'accepted',checks:taskSpec.criteria.map(()=>true),deliveryChecks:{[routeInput.id]:routeInput.contract.criteria.map(()=>true)},note:'不完整交付不应通过'});
  check(!incompleteReview.ok, 'incomplete item evidence rejects acceptance');
  const complete=await submit(routeInput,[item(routeInput,'路线独立正文：落地后先前往酒店。'),item(sourceInput,'独立来源说明：这是安装验证人工样例，不含真实旅行数据。')]);
  snapshot=await core.load();
  check(snapshot.collaboration.tasks[routeInput.taskKey].status==='in_review' && noFinalReceipts(snapshot), 'complete contribution does not impersonate final assembly');
  const accepted=await command('review',routeInput,{submissionId:complete.resourceId,verdict:'accepted',checks:taskSpec.criteria.map(()=>true),deliveryChecks:Object.fromEntries(slotsFor(snapshot,routeInput.taskKey).map(slot=>[slot.id,slot.contract.criteria.map(()=>true)])),note:'隔离安装样例已逐项核对路线与来源'});
  check(accepted.ok, 'accept complete contribution: '+accepted.message);
  snapshot=await core.load();
  const acceptedArtifactId=snapshot.collaboration.tasks[routeInput.taskKey].acceptedArtifactId;
  check(acceptedArtifactId, 'accepted contribution is versioned');
  // Register explicit manual assembly outputs; runtime auto-dispatch is covered by project-assembly.test.ts.
  await submit(route,[item(route,'最终路线正文：落地后先前往酒店。')],[acceptedArtifactId]);
  await submit(source,[item(source,'最终来源说明：引用已核对的路线任务版本。')],[acceptedArtifactId]);
  snapshot=await core.load();
  for(const slot of [route,source]) {
    const artifact=snapshot.collaboration.artifacts.find(value=>value.key===slot.taskKey);
    check(artifact?.deliveryReceipts?.some(receipt=>receipt.slotId===slot.id&&receipt.contractRevision===slot.contract.revision) && artifact.sourceIds.includes(acceptedArtifactId), 'final output retains its own receipt and source version');
    check(snapshot.collaboration.tasks[slot.taskKey].status==='in_review'&&!snapshot.collaboration.tasks[slot.taskKey].acceptedArtifactId, 'final candidate is not implicitly accepted');
  }
  check(!snapshot.collaboration.tasks[hotel.taskKey].latestSubmissionId, 'unfinished hotel remains empty');
  check(!Object.keys(snapshot.sessions).length && !Object.keys(snapshot.collaboration.runs).length, 'no fake AI runs');
  check(!(snapshot.integration?.versions??[]).length, 'candidate assembly is not a formal publication');
  const persisted=store.read('quandeck.projects.v1').projects[projectId];
  check(persisted.collaboration.goalPlans[planId].at(-1).slots.length===3, 'slot definitions persisted');
  check(persisted.ideaPlans[planId].adopted.doc.sections.some(section=>section.id==='route-outline'), 'outline persisted in approved version');
  check(persisted.collaboration.artifacts.length===5 && persisted.collaboration.artifacts.at(-1).sourceIds.includes(acceptedArtifactId), 'item receipts and assembly provenance persist');
  return {projectId,planId,route,source,hotel,result:{ok:true,projectDirection:true,outlinePersisted:true,strictContract:true,contributionTasks:2,assemblyTasks:3,declaredSlots:3,explicitEmptyPreserved:true,partialTaskIncomplete:true,partialAcceptanceRejected:true,partialAssembly:true,candidateNotAccepted:true}};
}

export async function checkGoalDelivery(core, store, webContents) {
  const {planId,route,source,hotel,result}=await checkGoalDeliveryData(core,store);
  const wait = async (predicate, label) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Goal delivery smoke timed out: ' + label);
  };
  await webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='任务')?.click()`);
  await wait(()=>webContents.executeJavaScript(`!!document.querySelector('.qd-journal') && document.body.innerText.includes('安装验证 · 自动交付地图')`),'project workspace');
  await webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='项目方向')?.click()`);
  await wait(()=>webContents.executeJavaScript(`!!document.querySelector('.qd-direction-doc[data-plan-id=${JSON.stringify(planId)}]') && document.querySelector('.qd-direction-body')?.textContent.includes('路线独立核查')`),'project direction body');
  await webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('quandeck:show-results'))`);
  const states=[[route.id,'candidate'],[source.id,'candidate'],[hotel.id,'blocked']];
  await wait(()=>webContents.executeJavaScript(`${JSON.stringify(states)}.every(([id,state])=>document.querySelector('button[data-delivery-slot="'+id+'"][data-state="'+state+'"]'))`),'independent final candidates and unfinished hotel');
  await webContents.executeJavaScript(`document.querySelector('button[data-delivery-slot=${JSON.stringify(route.id)}]')?.click()`);
  await wait(()=>webContents.executeJavaScript(`document.body.innerText.includes('最终路线正文：落地后先前往酒店。')`),'per-item candidate detail');
  return {...result,rendered:true};
}
