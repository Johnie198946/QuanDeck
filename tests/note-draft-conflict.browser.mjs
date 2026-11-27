import assert from 'node:assert/strict';
const { chromium } = await import(process.env.QUANDECK_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QUANDECK_UI_URL || 'http://127.0.0.1:4321';
const browser = await chromium.launch({ headless:true, channel:'chrome' });
try {
  const page = await browser.newPage();
  await page.goto(origin + '/src/data/knowledgeNotes.ts');
  const first = await page.evaluate(async () => {
    const m = await import('/src/components/knowledge/noteDraft.ts');
    const at = '2026-11-26T03:00:00.000Z';
    const note = { ...m.blankNote('restore'), revision:8, title:'计划', body:'已保存的其他编辑', updatedAt:at };
    const key = 'quandeck.personal-knowledge.v1';
    const prefix = 'quandeck.note-draft.v1.restore.';
    localStorage.setItem(key, JSON.stringify({schema:1,notes:[note],decisions:[]}));
    sessionStorage.setItem('quandeck.note-draft-writer','self');
    const old = { baseRevision:7, title:'计划', body:'旧窗口里的独立编辑', incoming:[], editedAt:at };
    const newer = { ...old, body:'选中这一句派发', editedAt:'2026-11-27T03:05:00.000Z' };
    localStorage.setItem(prefix+'self',JSON.stringify(old));
    localStorage.setItem(prefix+'prior',JSON.stringify(newer));
    const session = m.noteDraftSession(note,true);
    let caught;
    try { await m.flushDraft(session,true); } catch (e) { caught=e; }
    const check = {
      newest:session.view.body===newer.body,
      typed:caught instanceof m.NoteDraftConflictError && caught.stored.body===note.body,
      kept:JSON.parse(localStorage.getItem(key)).notes[0].body===note.body &&
        JSON.parse(localStorage.getItem(prefix+'self')).body===old.body &&
        JSON.parse(localStorage.getItem(prefix+'prior')).body===newer.body,
    };
    m.editDraft(session,{body:newer.body+'，补充期限'});
    return check;
  });
  assert.deepEqual(first,{ newest:true,typed:true,kept:true });
  // Simulate closing the app before the retry, and a fresh writer on reopening.
  await page.reload();
  const restored = await page.evaluate(async () => {
    const m = await import('/src/components/knowledge/noteDraft.ts');
    const key = 'quandeck.personal-knowledge.v1', prefix = 'quandeck.note-draft.v1.restore.';
    sessionStorage.setItem('quandeck.note-draft-writer','reopened');
    const previous = JSON.parse(localStorage.getItem(key)).notes[0];
    const session = m.noteDraftSession(previous,true);
    const baseWasNotAssumed = session.view.base===undefined;
    let conflict;
    try { await m.flushDraft(session,true); } catch (e) { if (e instanceof m.NoteDraftConflictError) conflict=e.stored; else throw e; }
    if (!conflict) throw Error('Older recovered drafts still need review');
    const unrelated = localStorage.getItem(prefix+'self');
    await m.saveReviewedDraft(session,conflict);
    return { baseWasNotAssumed, saved:JSON.parse(localStorage.getItem(key)).notes[0].body,
      inheritedRetired:!localStorage.getItem(prefix+'prior'),
      independentPreserved:!!unrelated && unrelated===localStorage.getItem(prefix+'self'),
    };
  });
  assert.deepEqual(restored,{baseWasNotAssumed:true,saved:'选中这一句派发，补充期限',inheritedRetired:true,independentPreserved:true});

  const merged = await page.evaluate(async () => {
    const m = await import('/src/components/knowledge/noteDraft.ts');
    const key = 'quandeck.personal-knowledge.v1';
    const store = note => localStorage.setItem(key,JSON.stringify({schema:1,notes:[note],decisions:[]}));
    const note = { ...m.blankNote('same-base'), revision:2, title:'日程', body:'原有文字' };
    store(note);
    const session=m.noteDraftSession(note,true);
    m.editDraft(session,{body:'本地编辑'});
    const updated={...note,revision:3,attachments:[{id:'file-v2',name:'归档.txt',size:3,type:'text/plain'}],readReceiptIds:['r1']};
    store(updated);
    const saved=await m.flushDraft(session,true);
    m.syncSavedNote(session,updated);
    const fresh=m.noteDraftSession({...note,id:'other'},true);
    const oldCopy={...note,updatedAt:new Date().toISOString(),revision:1};
    m.syncSavedNote(fresh,oldCopy);
    return { saved:saved.body, retained:saved.attachments[0]?.id, receipt:saved.readReceiptIds[0],
      outOfOrderIgnored:session.view.baseRevision===saved.revision && fresh.view.baseRevision===2 };
  });
  assert.deepEqual(merged,{saved:'本地编辑',retained:'file-v2',receipt:'r1',outOfOrderIgnored:true});
  const raced = await page.evaluate(async () => {
    const m=await import('/src/components/knowledge/noteDraft.ts');
    const key='quandeck.personal-knowledge.v1', draftKey='quandeck.note-draft.v1.race.previous';
    const note={...m.blankNote('race'),revision:2,body:'原文',title:'同一笔记'};
    localStorage.setItem(key,JSON.stringify({schema:1,notes:[note],decisions:[]}));
    const inherited={baseRevision:2,title:note.title,body:'刚恢复的内容',incoming:[],editedAt:'2026-11-27T01:00:00Z'};
    localStorage.setItem(draftKey,JSON.stringify(inherited));
    const session=m.noteDraftSession(note,true);
    m.editDraft(session,{body:'在恢复的内容上继续修改'});
    const changed=JSON.stringify({...inherited,body:'旧窗口刚刚输入的新内容'});
    localStorage.setItem(draftKey,changed);
    await m.flushDraft(session,true);
    return changed===localStorage.getItem(draftKey);
  });
  assert(raced,'a source writer changed after adoption must survive');
  console.log('PASS: newest recovered draft, typed stored conflict, no unreviewed overwrite, verified ancestor cleanup across restarts, independent drafts, same-base metadata merge and late snapshots.');
} finally { await browser.close(); }
