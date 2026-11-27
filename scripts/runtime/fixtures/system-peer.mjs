// Test-only system-assistance peer. Never packaged or used for real inference.
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
let session, unsafe = false, noteRoute, noteSystemPrompt;
const send = value => process.stdout.write(JSON.stringify({ jsonrpc:'2.0', ...value })+'\n');
readline.createInterface({input:process.stdin}).on('line', line => {
  const m=JSON.parse(line),p=m.params??{};
  if(m.method==='initialize')send({id:m.id,result:{userAgent:'quandeck-isolated-peer'}});
  else if(m.method==='config/read')send({id:m.id,result:{config:{mcp_servers:{foreign:{command:'must-never-run'}}}}});
  else if(m.method==='configRequirements/read')send({id:m.id,result:{requirements:null}});
  else if(m.method==='thread/start'||m.method==='thread/resume'){
    unsafe=p.model==='unsafe';
    noteRoute=p.modelProvider && p.config?.['model_providers.' + p.modelProvider];
    noteSystemPrompt=p.baseInstructions;
    const valid=(p.ephemeral===true || (noteSystemPrompt.includes('所选文字') && (p.ephemeral===false || !!p.threadId)))&&p.environments?.length===0&&p.dynamicTools?.length===0&&p.selectedCapabilityRoots?.length===0&&p.config?.mcp_servers?.foreign?.enabled===false&&p.config?.web_search==='disabled'&&p.config?.model_max_output_tokens===undefined&&p.config?.['features.shell_tool']===false&&p.config?.['features.hooks']===false&&p.config?.project_doc_max_bytes===0&&readdirSync(p.cwd).length===0&&process.argv.includes('features.shell_tool=false');
    if(!valid){send({id:m.id,error:{code:-32602,message:'isolation options missing'}});return;}
    session=p.threadId||randomUUID();send({id:m.id,result:{thread:{id:session},sandbox:{type:unsafe?'workspaceWrite':'readOnly',networkAccess:false},approvalPolicy:'never',instructionSources:[]}});
  }else if(m.method==='mcpServerStatus/list')send({id:m.id,result:{data:[],nextCursor:null}});
  else if(m.method==='turn/start'){
    send({id:m.id,result:{turn:{id:'system-turn'}}});
    const prompt=p.input[0].text;
    if (prompt.startsWith('TEST_NOTE_CONVERSATION')) {
      const text = prompt.includes('此前只属于') ? 'replayed' : 'direct';
      send({method:'item/completed',params:{threadId:session,item:{type:'agentMessage',id:'a',text}}});
      send({method:'turn/completed',params:{threadId:session,turn:{status:'completed'}}});return;
    }
    if (prompt === '翻译\n\nNOTE_PLAIN_TEXT') {
      if ('outputSchema' in p || noteRoute?.wire_api !== 'responses' || noteRoute.supports_websockets !== false || !noteRoute.requires_openai_auth || /JSON/.test(noteSystemPrompt) || !['日常话','两三点','用户指定格式','翻译只给译文'].every(term => noteSystemPrompt.includes(term))) {
        send({method:'turn/completed',params:{threadId:session,turn:{status:'failed'}}}); return;
      }
      const delta = '一行翻译。';
      const suffix = '\n' + '原样输出 '.repeat(60);
      send({method:'item/reasoning/textDelta',params:{threadId:session,itemId:'private',delta:'模型推理'}});
      send({method:'item/agentMessage/delta',params:{threadId:session,itemId:'a',delta}});
      send({method:'item/agentMessage/delta',params:{threadId:session,itemId:'a',delta:suffix}});
      send({method:'item/completed',params:{threadId:session,item:{type:'agentMessage',id:'a',text:delta+suffix}}});
      send({method:'turn/completed',params:{threadId:session,turn:{status:'completed'}}});return;
    }
    if(prompt.startsWith('CHECK_INTEGRATION_STREAM')) {
      const expected = prompt.endsWith('personal');
      if (!!noteRoute !== expected || (noteRoute && noteRoute.supports_websockets !== false) || !p.outputSchema || p.effort !== undefined || !noteSystemPrompt.includes('JSON')) {
        send({method:'turn/completed',params:{threadId:session,turn:{status:'failed'}}});return;
      }
    }
    if(prompt.includes('IDLE_STREAM')) {
      send({method:'error',params:{threadId:session,willRetry:true,error:{message:'request timed out'}}});
      const mode=prompt.split(' ')[1];
      let n=0;
      const tick=setInterval(()=>{
        n++;
        if(mode==='completed-reasoning' || mode==='duplicate-reasoning')
          send({method:'item/completed',params:{threadId:session,item:{type:'reasoning',id:mode==='completed-reasoning'?'reason-'+n:'reason-replayed'}}});
        else if(mode==='usage')send({method:'thread/tokenUsage/updated',params:{threadId:session,tokenUsage:{total:{totalTokens:n}}}});
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
