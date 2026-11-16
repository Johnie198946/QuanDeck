// Contract fixture, not a live DSH model. Flat plugin shape follows rc.2 base/sdk bundles.
import readline from 'node:readline';
import {readFileSync,realpathSync} from 'node:fs';
const required=['llm','session','agent','tools','system-prompt','agent-loop','sdk-app','sdk-jsonrpc-server'];
const base=[...required,'agent-default-model','session-persistence-jsonl','tool-bash-persistent','agent-instructions','session-title-first-prompt-llm','hmr','settings','config-editor'].map((name,index)=>({id:`plugin-${index}`,name:`@deepseek-ai/dsh-${name}`,...(name==='agent-default-model'?{config:{provider:'configured-provider',model:'configured-model'}}:{})}));
base.push({id:'custom-plugin',name:'private-custom-tools'});
if(process.argv.includes('--version')) {console.log(process.env.QD_FIXTURE_MODERN ? '99.0.0-contract' : '0.2.0-rc.2');process.exit(0);}
const patchAt=process.argv.indexOf('--patch');
const patch=patchAt<0?null:JSON.parse(readFileSync(process.argv[patchAt+1],'utf8'));
const composed=base.map(row=>({...row,...patch?.find(entry=>entry.id===row.id)}));
if(process.argv.includes('--dump-config')) {console.log(JSON.stringify(composed));process.exit(0);}
if(!patch || composed.filter(row=>!row.disabled).some(row=>/bash|instructions|custom|persistence|first-prompt|hmr|settings|config-editor/.test(row.name))) process.exit(3);
const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line),p=m.params??{};
 if(m.method==='initialize'){
  if(p.provider!=='configured-provider'||p.model!=='configured-model'||(process.env.QD_FIXTURE_MODERN ? p.approvalRequests!==true : p.approvalRequests!==undefined)||realpathSync(p.cwd)!==realpathSync(process.cwd())||p.maxTokens!==undefined) {send({id:m.id,error:{message:'invalid isolated initialize'}});return;}
  send({id:m.id,result:{serverInfo:{name:'deepseek-harness-sdk-runtime'}}});
 }else if(m.method==='session/prompt'){
  send({id:m.id,result:{messageId:'acknowledged'}});
  const text=p.contentBlocks[0].text, event=(type,data)=>send({method:'session.event',params:{sessionId:p.sessionId,event:{type,data}}});
  if(text.includes('TIMEOUT'))return;
  if(text.includes('REQUEST_TOOL')){event('tool/call',{name:'forbidden',callId:'one'});return;}
  event('assistant/message',{message:{content:[{type:'text',text:JSON.stringify(text.includes('TITLE')?{title:'简洁标题'}:{reply:'hello'})}]},usage:{totalTokens:10}});
  event('turn/end',{reason:{kind:'completed'}});
 }else if(m.method==='shutdown'){send({id:m.id,result:{}});process.exit(0);}
});
