import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';

/** Per-run read capability; deliberately separate from the desktop's command bearer. */
export async function createContextAccess({ read, now = Date.now }) {
  const capabilities = new Map();
  const digest = value => createHash('sha256').update(value).digest('hex');
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    const reply=(status,value)=>{res.writeHead(status);res.end(JSON.stringify(value));};
    if(req.method!=='GET'||req.headers.origin||!/^127\.0\.0\.1:\d+$/.test(req.headers.host??''))return reply(403,{error:'READ_ONLY_CAPABILITY_REQUIRED'});
    const token=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization??'')?.[1];
    const capability=token&&capabilities.get(digest(token));
    if(!capability||capability.expiresAt<=now())return reply(401,{error:'CAPABILITY_EXPIRED'});
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname!=='/evidence'||[...url.searchParams.keys()].some(key=>!['artifactId','hash','offset','limit'].includes(key)))return reply(400,{error:'INVALID_QUERY'});
    const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??4000);
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>4000)return reply(400,{error:'INVALID_PAGE'});
    try {
      const page=await read({...capability.binding,artifactId:url.searchParams.get('artifactId'),hash:url.searchParams.get('hash'),offset,limit});
      reply(200,page);
    } catch(error) { reply(409,{error:'SOURCE_OR_RUN_CHANGED',message:'资料或执行权限已变化，请重新核对当前任务'}); }
  });
  server.requestTimeout=5000;server.headersTimeout=5000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const endpoint=`http://127.0.0.1:${server.address().port}/evidence`;
  return {
    instructions(binding,grants=[]){
      for(const [key,value] of capabilities)if(value.expiresAt<=now())capabilities.delete(key);
      const token=randomBytes(32).toString('hex');
      capabilities.set(digest(token),{binding:structuredClone({...binding,grants}),expiresAt:now()+8*60*60*1000});
      return `按需读取资料：仅当固定资料标记 truncated 或已明确授权跨项目引用时，使用只读 GET ${endpoint}?artifactId=<资料ID>&hash=<固定hash>&offset=<nextOffset>&limit=4000，HTTP Authorization: Bearer ${token}。每页最多4000字符，只能读取本次固定的来源；响应nextOffset为null即结束。不得把令牌写入成果。若返回权限失效，报告阻塞，不尝试其他任务或文件。`;
    },
    async close(){capabilities.clear();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));},
  };
}
