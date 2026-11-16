import test from 'node:test';
import assert from 'node:assert/strict';
import { createContextAccess } from './context-access.mjs';
test('context capability scopes reads, rejects browser origins, expires and bounds cumulative input',async()=>{
  let clock=1000, revoked=false;const calls=[];
  const server=await createContextAccess({now:()=>clock,maxReadChars:8,read:request=>{calls.push(request);if(revoked)throw Error('revoked');return {text:'ok',nextOffset:null};}});
  try {
    const text=server.instructions({projectId:'p',runId:'run',claimEpoch:3,contextPackageId:'pack'});
    const endpoint=text.match(/GET (http:\/\/[^?]+)/)[1],token=text.match(/Bearer ([a-f0-9]{64})/)[1];
    const url=endpoint+'?artifactId=a&hash=h&limit=4',headers={Authorization:'Bearer '+token};
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{...headers,Origin:'https://example.com'}})).status,403);
    assert.equal((await fetch(url+'&projectId=evil',{headers})).status,400);
    assert.equal((await fetch(url,{headers})).status,200);assert.equal(calls[0].projectId,'p');assert.equal(calls[0].claimEpoch,3);
    revoked=true;assert.equal((await fetch(url,{headers})).status,409);
    revoked=false;assert.equal((await fetch(url,{headers})).status,200);assert.equal((await fetch(url,{headers})).status,429);
    clock+=8*60*60*1000;assert.equal((await fetch(url,{headers})).status,401);
  } finally {await server.close();}
});
