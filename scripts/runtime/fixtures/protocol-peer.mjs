// Synthetic transport contract peer; not proof that a released DSH version implements these capabilities.
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
if (process.argv.includes('--version')) { process.stdout.write('DSH 99.0.0-contract-test\n'); process.exit(0); }
let echoApproval = false;
let session = '', tool = process.argv.includes('sdk') ? 'dsh' : 'codex';
const send = x => process.stdout.write(JSON.stringify({ jsonrpc:'2.0', ...x })+'\n');
const notify = (method, params) => send({method,params});
const finish = () => {
 if(tool==='dsh') {
  notify('session.event',{sessionId:session,event:{seq:8,type:'assistant/message',data:{message:{content:[{type:'text',text:'已完成本轮真实协议测试'}]},usage:{inputTokens:10,outputTokens:5,totalTokens:15}}}});
  notify('session.event',{sessionId:session,event:{seq:9,type:'turn/end',data:{reason:{kind:'completed'}}}});
 } else {
  notify('item/completed',{threadId:session,item:{type:'agentMessage',id:'reply1',text:'Codex 回报'}});
  notify('turn/completed',{threadId:session,turn:{id:'turn1',status:'completed'}});
 }
};
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line),p=m.params||{};
 if(m.method==='initialize') { if(p.model==='invalid'){send({id:m.id,error:{code:-32602,message:'Unknown model'}});return;} send({id:m.id,result: tool==='dsh'?{serverInfo:{name:'deepseek-harness-sdk-runtime',version:'test-contract'}}:{userAgent:'test'}}); }
 else if(m.method==='shutdown'){send({id:m.id,result:{}});setTimeout(()=>process.exit(0),5);}
 else if(m.method==='account/read')send({id:m.id,result:{account:{type:'chatgpt'}}});
 else if(m.method==='thread/start'||m.method==='thread/resume'){session=p.threadId||(p.model==='reuse-source'?'019a7d11-6213-7110-9279-000000000003':randomUUID());send({id:m.id,result:{thread:{id:session,cwd:process.cwd()}}});}
 else if(m.method==='session/resume'){session=p.sessionId;send({id:m.id,result:{}});}
 else if(m.method==='session/prompt'||m.method==='turn/start'){
  session=p.sessionId||p.threadId;
  send({id:m.id,result:tool==='dsh'?{messageId:'receipt'}:{turn:{id:'turn1'}}});
  const prompt=tool==='dsh'?p.contentBlocks[0].text:p.input[0].text;
  if(tool==='dsh')notify('session.status',{sessionId:session,status:'running'});
  else {notify('turn/started',{threadId:session,turn:{id:'turn1'}});notify('thread/tokenUsage/updated',{threadId:session,tokenUsage:{total:{totalTokens:25}}});notify('turn/plan/updated',{threadId:session,plan:[{step:'验证',status:'completed'},{step:'输出',status:'inProgress'}]});}
  if(prompt==='permission'){if(tool==='dsh')notify('session.event',{sessionId:session,event:{seq:1,type:'tool/call',data:{callId:'actual-call',name:'write',arguments:JSON.stringify({command:'echo TOKEN=contract-secret sk-contract-key-123456789'})}}});send({id:88,method:tool==='dsh'?'approval/request':'item/commandExecution/requestApproval',params:{sessionId:session,threadId:session,reason:'需要写入临时文件',toolName:'write',callId:'actual-call'}});}
  else if(prompt==='permission-profile'){echoApproval=true;send({id:88,method:'item/permissions/requestApproval',params:{threadId:session,reason:'读取所选项目资料',permissions:{network:null,fileSystem:{read:['/test/project'],write:null}}}});}
  else if(prompt==='permission-scopes'||prompt==='permission-restricted'||prompt==='permission-file'){
   echoApproval=true;
   const availableDecisions=prompt==='permission-restricted'?['acceptForSession','decline']:['accept','acceptForSession',{acceptWithExecpolicyAmendment:{execpolicy_amendment:['git','status']}},{applyNetworkPolicyAmendment:{network_policy_amendment:{host:'example.com',action:'allow'}}},'decline','cancel'];
   send({id:88,method:prompt==='permission-file'?'item/fileChange/requestApproval':'item/commandExecution/requestApproval',params:{threadId:session,command:'git status --short',...(prompt==='permission-file'?{grantRoot:'/test/project'}:{availableDecisions})}});
  }
  else if(prompt==='question'){send({id:89,method:tool==='dsh'?'user-question/ask':'item/tool/requestUserInput',params:{requestId:'question1',sessionId:session,questions:[{id:'days',question:'几天？'}]}});}
  else if(prompt==='retry-chatter'){
   notify('error',{threadId:session,willRetry:true,error:{message:'request timed out'}});
   setTimeout(()=>notify('error',{threadId:session,willRetry:true,error:{message:'request timed out'}}),30);
   setTimeout(()=>notify('thread/status/changed',{threadId:session,status:{type:'active'}}),60);
   setTimeout(finish,220);
  }
  else if(prompt==='retry'){notify('error',{threadId:session,turnId:'turn1',willRetry:true,error:{message:'Reconnecting...'}});finish();}
  else if(prompt==='child-states'){notify('item/completed',{threadId:session,item:{type:'collabAgentToolCall',agentsStates:Object.fromEntries(['pendingInit','running','interrupted','completed','errored','shutdown','notFound'].map(status=>[status,{status}]))}});finish();}
  else if(prompt==='children'){notify('subagent.started',{parentSessionId:session,childSessionId:'child-1'});notify('session.event',{sessionId:'child-1',event:{seq:1,type:'assistant/message',data:{message:{content:[{type:'text',text:'子 Agent 的公开输出'}]},usage:{totalTokens:2}}}});notify('subagent.finished',{parentSessionId:session,childSessionId:'child-1',status:'ok',lastAssistantMessage:[{type:'text',text:'子任务输出'}]});finish();}
  else if(prompt==='silent') {}
  else if(prompt==='slow-finish')setTimeout(finish,200);
  else if(prompt==='network-fail'){notify('error',{threadId:session,error:{message:'ECONNRESET token=private-token sk-test-secret-123456789'}});}
  else if(prompt==='crash')process.exit(2);
  else finish();
 }
 else if(m.method==='turn/interrupt'){send({id:m.id,result:{}});}
 else if(m.id===88||m.id===89){if(m.result){if(echoApproval)notify('quandeck/event',{event:{log:{kind:'tool',label:'fixture approval receipt',detail:JSON.stringify(m.result)}}});finish();}}
});
