// TEST ONLY. Exercises the unmodified official SDK against its stdio control protocol.
import readline from 'node:readline';import {randomUUID}from'node:crypto';
const args=process.argv.slice(2),sid=args[args.indexOf('--session-id')+1]||randomUUID();let last;
const send=v=>process.stdout.write(JSON.stringify(v)+'\n');
const finish=()=>{send({type:'assistant',uuid:randomUUID(),session_id:sid,parent_tool_use_id:null,message:{id:randomUUID(),role:'assistant',content:[{type:'text',text:'公开结论'}]}});send({type:'result',subtype:'success',is_error:false,uuid:randomUUID(),session_id:sid,user_message_uuid:last.uuid,result:'公开结论',modelUsage:{test:{inputTokens:12,outputTokens:4,cacheReadInputTokens:2,cacheCreationInputTokens:1}},usage:{input_tokens:12,output_tokens:4},num_turns:1});};
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);
 if(m.type==='control_request'){const subtype=m.request.subtype;send({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:subtype==='initialize'?{commands:[],agents:[],models:[],account:{apiKeySource:'user'}}:{}}});}
 if(m.type==='user'){last=m;const text=m.message.content.map(x=>x.text).join('');if(text==='delayed'){setTimeout(()=>{send({...m,isReplay:true});finish();},150);return;}send({...m,isReplay:true});if(text==='permission'||text==='question'){send({type:'control_request',request_id:'request-one',request:{subtype:'can_use_tool',tool_name:text==='permission'?'Bash':'AskUserQuestion',tool_use_id:'tool-one',input:text==='permission'?{command:'echo contract'}:{questions:[{question:'去几天？',header:'天数',options:[{label:'三天'}]}]}}});}else finish();}
 if(m.type==='control_response'){finish();}
});
