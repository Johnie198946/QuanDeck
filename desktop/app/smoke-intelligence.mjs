/** Native UI regression in the installer's isolated, unconfigured workspace only. */
export async function checkIntelligence(core, webContents) {
  const require = (condition, message) => { if (!condition) throw new Error('Intelligence smoke: ' + message); };
  const wait = async predicate => {
    for (let attempt = 0; attempt < 100; attempt++) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Intelligence smoke timed out waiting for persisted UI action');
  };
  const enter = async text => {
    await webContents.executeJavaScript(`(() => { const input = document.querySelector('input[aria-label="记录想法或输入任务"]'); if (!input) throw new Error('Input missing'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await new Promise(resolve => setTimeout(resolve, 100));
    await webContents.executeJavaScript(`document.querySelector('form.qd-composer').requestSubmit()`);
  };
  const raw = '明天下午整理旅行交通资料';
  const before = await core.load();
  require(before.agents.length === 0 && !Object.keys(before.sessions).length, 'fixture must contain no configured Agent or fabricated session');
  await enter(raw);
  const intake = await wait(async () => (await core.load()).intelligence?.intakes.find(item => item.text === raw));
  await wait(async () => (await core.load()).intelligence?.intakeStates[intake.id]?.status === 'failed');
  let snapshot = await core.load();
  require(snapshot.journal.blocks.some(block => block.kind === 'text' && block.text === raw), 'failed AI request preserves original text');
  require(Object.keys(snapshot.tasks).length === Object.keys(before.tasks).length, 'unavailable AI cannot fabricate a classification task');
  const count = snapshot.intelligence.intakes.length;
  await enter('[] 安装检查的手动待办');
  await wait(async () => Object.values((await core.load()).tasks).some(task => task.title === '安装检查的手动待办'));
  snapshot = await core.load();
  require(snapshot.intelligence.intakes.length === count, 'explicit manual creation must bypass AI classification');
  require(!Object.keys(snapshot.sessions).length, 'system assistance must not masquerade as a task session');
  await wait(() => webContents.executeJavaScript(`document.body.innerText.includes('安装检查的手动待办') && document.body.innerText.includes('AI 识别未完成，原文已保留')`));
  require(await webContents.executeJavaScript(`!document.querySelector('.qc-workspace') && !Array.from(document.querySelectorAll('nav button')).some(button => button.textContent.trim() === '协作')`), 'background ledger must not introduce a collaboration navigation');
  return { ok: true, rawInputPreserved: true, manualBypassesAI: true, noFakeTaskSession: true, originalNavigation: true };
}
