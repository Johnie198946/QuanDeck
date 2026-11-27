import assert from 'node:assert/strict';
import test from 'node:test';
import { createInspirationExtractor } from './app/inspiration-extractor.mjs';
import { knowledgeAttachment } from './app/attachment-preview.mjs';

const profile = {connectionId:'fixture',tool:'codex'};
const samples = [{id:'one', title:'路线', revision:2, body:'遇到延误时换路线。票价上限 500 元。',
  expansions:[{id:'answer',answer:'AI独有答案'}]}, {id:'two',title:'私密草稿',revision:1,body:'绝不发送'}];
function fixture(response) {
  const notes = structuredClone(samples), calls = [];
  const extract = createInspirationExtractor({readLibrary:()=>({notes}),readConfigured:()=>[profile],connections:()=>[profile],
    assist:async req => {
      calls.push(req);
      const materials = JSON.parse(req.prompt.split('\n').at(-1));
      const part = materials.find(m => m.source==='body').part;
      const make = (kind,quote,summary) => ({kind,quote,summary,part,goal:'路线',mechanism:'调整',constraint:'',domain:'旅行',features:Array(12).fill(0),entities:[]});
      const receipt = {...req,sourceSessionId:'session',toolPolicy:'read-only-isolated',contextPolicy:'new-isolated-session',output:{atoms:[
        make('方法','遇到延误时换路线。','延误时换线'),make('约束','票价上限 500 元。','预算上限 500 元'),make('实体','路线','路线')] }};
      return response ? response(receipt,notes) : receipt;
    }});
  return {extract,calls,notes};
}
test('canvas extracts several grounded ideas from the selected author material, reuses unchanged results and stores offsets',async()=>{
  const {extract,calls,notes} = fixture();
  const [a,b] = await Promise.all([extract(['one']),extract(['one','one'])]);
  assert.deepEqual(a,b); assert.equal(a.length,2); assert.equal(calls.length,1);
  assert.doesNotMatch(calls[0].prompt,/绝不发送|私密草稿|AI独有答案/);
  for (const card of a) {
    const {start,end,revision,digest} = card.idea.source;
    assert.equal(revision,2);assert.ok(end>start);assert.match(digest,/^[a-f0-9]{64}$/);
    assert.ok(notes[0].body.slice(start,end)); assert.ok(!('quote' in card.idea.source));
  }
  assert.deepEqual(await extract(['one']),a);assert.equal(calls.length,1);
  await assert.rejects(extract(['missing']),/移除/);
});
test('changed source during extraction, invalid evidence or wrong receipt cannot be added as author ideas',async()=>{
  for (const alter of [(r,n) => { n[0].revision++;return r; },r=>({...r,requestId:'wrong'}),r=>{r.output.atoms[0].quote='invented';return r;}]) {
    await assert.rejects(fixture(alter).extract(['one']));
  }
});
test('reference files are resolved by their canvas owner exactly like existing note attachments',()=>{
  const file={id:'photo',name:'map.png',type:'image/png',size:32};
  const lib={notes:[{id:'other',attachments:[]}],inspirationCanvas:{nodes:[{noteId:'ref',idea:{reference:{file}}}]}};
  assert.equal(knowledgeAttachment(lib,'ref','photo'),file);
  assert.equal(knowledgeAttachment(lib,'other','photo'),undefined);
  assert.equal(knowledgeAttachment(lib,undefined,'photo'),file);
});
