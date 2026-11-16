/** Native UI regression in the installer's isolated, unconfigured workspace only. */
export async function checkIntelligence(core, webContents) {
  const require = (condition, message) => { if (!condition) throw new Error('Intelligence smoke: ' + message); };
  const wait = async (predicate, description) => {
    for (let attempt = 0; attempt < 100; attempt++) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Intelligence smoke timed out: ' + description);
  };
  const enter = async text => {
    await webContents.executeJavaScript(`(() => { const input = document.querySelector('textarea[aria-label="记录想法或输入任务"]'); if (!input) throw new Error('Task composer missing'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await new Promise(resolve => setTimeout(resolve, 100));
    await webContents.executeJavaScript(`document.querySelector('form.qd-composer').requestSubmit()`);
  };
  const raw = '明天下午整理旅行交通资料';
  let before = await core.load();
  require(before.agents.length === 0 && !Object.keys(before.sessions).length, 'fixture must contain no configured Agent or fabricated session');
  await enter('默认直接创建的任务');
  await wait(async () => Object.values((await core.load()).tasks).some(task => task.title === '默认直接创建的任务'), 'default task creation without AI');
  before = await core.load();
  require(!before.intelligence?.intakes.length, 'default task creation must not require an AI response');
  await webContents.executeJavaScript(`document.querySelector('.qd-mode').click()`);
  await wait(() => webContents.executeJavaScript(`!!document.querySelector('.qd-intake-modes')`), 'open input mode');
  await webContents.executeJavaScript(`Array.from(document.querySelectorAll('.qd-intake-modes button')).find(button => button.querySelector('strong')?.textContent === 'AI 识别').click()`);
  await wait(() => webContents.executeJavaScript(`!!document.querySelector('button[aria-label="输入方式：AI 识别"]')`), 'choose AI recognition');
  await enter(raw);
  const intake = await wait(async () => (await core.load()).intelligence?.intakes.find(item => item.text === raw), 'save original entry');
  await wait(async () => (await core.load()).intelligence?.intakeStates[intake.id]?.status === 'failed', 'record missing Agent failure');
  let snapshot = await core.load();
  require(snapshot.journal.blocks.some(block => block.kind === 'text' && block.text === raw), 'failed AI request preserves original text');
  require(Object.keys(snapshot.tasks).length === Object.keys(before.tasks).length, 'unavailable AI cannot fabricate a classification task');
  const count = snapshot.intelligence.intakes.length;
  await enter('[] 安装检查的手动待办');
  await wait(async () => Object.values((await core.load()).tasks).some(task => task.title === '安装检查的手动待办'), 'create manual task');
  snapshot = await core.load();
  require(snapshot.intelligence.intakes.length === count, 'explicit manual creation must bypass AI classification');
  require(!Object.keys(snapshot.sessions).length, 'system assistance must not masquerade as a task session');
  await wait(() => webContents.executeJavaScript(`document.body.innerText.includes('安装检查的手动待办') && Array.from(document.querySelectorAll('.qd-intake-feedback-item.is-error > summary')).some(summary => summary.textContent.includes('识别失败'))`), 'render manual task and classification failure');
  require(await webContents.executeJavaScript(`!document.querySelector('.qc-workspace') && !Array.from(document.querySelectorAll('nav button')).some(button => button.textContent.trim() === '协作')`), 'background ledger must not introduce a collaboration navigation');
  return { ok: true, defaultManual: true, rawInputPreserved: true, manualBypassesAI: true, noFakeTaskSession: true, originalNavigation: true };
}
