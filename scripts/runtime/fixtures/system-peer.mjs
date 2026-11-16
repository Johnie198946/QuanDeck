// Test-only system-assistance peer. Never packaged or used for real inference.
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
let session, unsafe = false;
const send = value => process.stdout.write(JSON.stringify({ jsonrpc:'2.0', ...value })+'\n');
readline.createInterface({input:process.stdin}).on('line', line => {
  const m=JSON.parse(line),p=m.params??{};
  if(m.method==='initialize')send({id:m.id,result:{userAgent:'quandeck-isolated-peer'}});
  else if(m.method==='config/read')send({id:m.id,result:{config:{mcp_servers:{foreign:{command:'must-never-run'}}}}});
  else if(m.method==='thread/start'){
    unsafe=p.model==='unsafe';
    const valid=p.ephemeral===true&&p.environments?.length===0&&p.dynamicTools?.length===0&&p.selectedCapabilityRoots?.length===0&&p.config?.mcp_servers?.foreign?.enabled===false&&p.config?.web_search==='disabled'&&p.config?.model_max_output_tokens===undefined&&p.config?.['features.shell_tool']===false&&p.config?.['features.hooks']===false&&p.config?.project_doc_max_bytes===0&&readdirSync(p.cwd).length===0&&process.argv.includes('features.shell_tool=false');
    if(!valid){send({id:m.id,error:{code:-32602,message:'isolation options missing'}});return;}
    session=randomUUID();send({id:m.id,result:{thread:{id:session},sandbox:{type:unsafe?'workspaceWrite':'readOnly',networkAccess:false},approvalPolicy:'never',instructionSources:[]}});
  }else if(m.method==='mcpServerStatus/list')send({id:m.id,result:{data:[],nextCursor:null}});
  else if(m.method==='turn/start'){
    send({id:m.id,result:{turn:{id:'system-turn'}}});
    const prompt=p.input[0].text;
    if(prompt.includes('IDLE_STREAM')) {
      send({method:'error',params:{threadId:session,willRetry:true,error:{message:'request timed out'}}});
      const mode=prompt.split(' ')[1];
      let n=0;
      const tick=setInterval(()=>{
        n++;
        if(mode==='usage')send({method:'thread/tokenUsage/updated',params:{threadId:session,tokenUsage:{total:{totalTokens:n}}}});
        else if(mode==='noise') {
          send({method:'turn/started',params:{threadId:session,turn:{id:'system-turn'}}});
          send({method:'error',params:{threadId:session,willRetry:true}});
          send({method:'item/agentMessage/delta',params:{threadId:session,itemId:'result',delta:''}});
          send({method:'thread/tokenUsage/updated',params:{threadId:session,tokenUsage:{total:{totalTokens:0}}}});
        } else if(mode==='replay') {
          send({method:'item/agentMessage/delta',params:{threadId:session,itemId:'result',delta:'same fragment'}});
          send({method:'thread/tokenUsage/updated',params:{threadId:session,tokenUsage:{total:{totalTokens:1}}}});
        } else send({method:mode==='reasoning'?'item/reasoning/summaryTextDelta':'item/agentMessage/delta',params:{threadId:session,itemId:'result',delta:`fragment ${n}`}});
        if(n===5) {
          clearInterval(tick);
          if(['noise','replay','stalled'].includes(mode))return;
          const binding=Object.fromEntries(Object.entries(p.outputSchema.properties.binding.properties).map(([key,v])=>[key,v.const]));
          send({method:'item/completed',params:{threadId:session,item:{type:'agentMessage',id:'result',text:JSON.stringify({schemaVersion:p.outputSchema.properties.schemaVersion.const,binding,result:{source:'user_input',intent:'note',decision:'keep_note',reason:'stream completed'}})}}});
          send({method:'thread/tokenUsage/updated',params:{threadId:session,tokenUsage:{total:{totalTokens:23}}}});
          send({method:'turn/completed',params:{threadId:session,turn:{id:'system-turn',status:'completed'}}});
        }
      },450);
      process.stdin.once('end',()=>clearInterval(tick));
      return;
    }
    if(prompt.includes('RETRY_TIMEOUT')){
      send({method:'error',params:{threadId:session,willRetry:true}});
      return;
    }
    if(prompt.includes('TIMEOUT'))return;
    if(prompt.includes('EXPECT_LOW_EFFORT')&&p.effort!=='low'){send({method:'turn/completed',params:{threadId:session,turn:{status:'failed'}}});return;}
    const delayedRecovery=prompt.includes('RETRY_RECOVER');
    if(delayedRecovery)send({method:'error',params:{threadId:session,willRetry:true,error:{message:'request timed out'}}});
    if(prompt.includes('REQUEST_TOOL')){send({method:'item/started',params:{threadId:session,item:{type:'mcpToolCall',tool:'forbidden'}}});return;}
    if(p.outputSchema?.properties?.reply){
      if(p.effort!=='low'){send({method:'turn/completed',params:{threadId:session,turn:{status:'failed'}}});return;}
      send({method:'item/completed',params:{threadId:session,item:{type:'agentMessage',text:'{"reply":"hello"}'}}});
      send({method:'turn/completed',params:{threadId:session,turn:{status:'completed'}}});return;
    }
    const schema=p.outputSchema;
    const binding=Object.fromEntries(Object.entries(schema.properties.binding.properties).map(([key,v])=>[key,v.const]));
    const result={schemaVersion:schema.properties.schemaVersion.const,binding,result:{source:'user_input',intent:'note',decision:'keep_note',reason:'Only a note'}};
    const deliver=()=>{
    send({method:'item/completed',params:{threadId:session,item:{type:'agentMessage',id:'system-result',text:JSON.stringify(result)}}});
    send({method:'thread/tokenUsage/updated',params:{threadId:session,tokenUsage:{total:{totalTokens:23}}}});
    send({method:'turn/completed',params:{threadId:session,turn:{id:'system-turn',status:'completed'}}});
    };if(delayedRecovery)setTimeout(deliver,1200);else deliver();
  }
});
