import test from 'node:test';
import assert from 'node:assert/strict';
import { createContextAccess } from './context-access.mjs';
test('context capability scopes reads, rejects browser origins, expires and preserves unlimited authenticated paging',async()=>{
  let clock=1000, revoked=false;const calls=[];
  const server=await createContextAccess({now:()=>clock,read:request=>{calls.push(request);if(revoked)throw Error('revoked');return {text:'ok',nextOffset:null};}});
  try {
    const text=server.instructions({projectId:'p',runId:'run',claimEpoch:3,contextPackageId:'pack'});
    const endpoint=text.match(/GET (http:\/\/[^?]+)/)[1],token=text.match(/Bearer ([a-f0-9]{64})/)[1];
    const url=endpoint+'?artifactId=a&hash=h&limit=4',headers={Authorization:'Bearer '+token};
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{...headers,Origin:'https://example.com'}})).status,403);
    assert.equal((await fetch(url+'&projectId=evil',{headers})).status,400);
    assert.equal((await fetch(url,{headers})).status,200);assert.equal(calls[0].projectId,'p');assert.equal(calls[0].claimEpoch,3);
    const search=new URL(endpoint);
    search.search=new URLSearchParams({artifactId:'project-index',hash:'snapshot-hash',query:'梨园',limit:'100'}).toString();
    assert.equal((await fetch(search,{headers})).status,200);
    assert.equal(calls.at(-1).query,'梨园');assert.equal(calls.at(-1).projectId,'p');
    assert.equal((await fetch(url+'&query=unscoped',{headers})).status,400);
    search.searchParams.set('query','x'.repeat(129));
    assert.equal((await fetch(search,{headers})).status,400);
    revoked=true;assert.equal((await fetch(url,{headers})).status,409);
    revoked=false;assert.equal((await fetch(url,{headers})).status,200);assert.equal((await fetch(url,{headers})).status,200);
    clock+=8*60*60*1000;assert.equal((await fetch(url,{headers})).status,401);
  } finally {await server.close();}
});
