export async function seedNoteAgentSession(page, { received = false } = {}) {
  await page.addInitScript(({ received }) => {
    const key = 'quandeck.personal-knowledge.v1';
    const quote = '比较京都到和歌山的路线。';
    const body = '旅行准备：' + quote;
    const at = new Date().toISOString();
    localStorage.setItem(key, JSON.stringify({ schema: 1, decisions: [], notes: [
      { id: 'route', title: '旅行准备', body, createdAt: at, updatedAt: at, revision: 1, attachments: [], expansions: [], history: [] },
    ] }));

    async function backend() {
      const { LocalWorkdeckDataSource } = await import('/src/data/repository.ts');
      const { createRuntimeDataSource } = await import('/src/data/runtimeDataSource.ts');
      const { makeSelection } = await import('/src/data/knowledgeNotes.ts');
      const { noteSelectionTaskKey } = await import('/src/data/noteTaskSource.ts');
      const base = new LocalWorkdeckDataSource(), runs = [];
      let listener;
      function emit(run, payload) {
        const sequence = run.events.length + 1;
        const event = { id: run.runId + sequence, sequence, runId: run.runId, sessionId: run.sessionId, at: new Date().toISOString(), ...payload };
        run.events.push(event);
        listener(event);
      }
      // Only the external process is simulated. Its events enter the real runtime/repository.
      const api = createRuntimeDataSource(base, {
        subscribe(callback) { listener = callback; return () => {}; },
        listRuns: () => runs, scan: async () => [],
        prepareAttachments: input => window.inboxTest.prepareAttachments(input),
        async control(id, action) {
          const stoppedConfirmed = action === 'stop';
          emit(runs.find(r => r.runId === id), { status: stoppedConfirmed ? 'paused' : 'running', stoppedConfirmed });
          return { stoppedConfirmed };
        },
        async run(input) {
          const n = runs.length;
          const run = { ...input, runId: 'run' + n, sessionId: 'session' + n, acceptedAt: at, acceptance: 'acknowledged', events: [] };
          runs.push(run);
          return run;
        },
      });
      const ok = r => { if (!r.ok) throw Error(r.message); return r; };
      const projectId = ok(await api.createProject({ name: '旅行计划' })).projectId;
      ok(await api.registerAgent({ id: 'codex', name: 'Codex', short: 'Codex', color: '#234567' }));
      ok(await api.bindRuntimeConnection('codex', { tool: 'codex', connectionId: 'test', projectPath: '/isolated/travel', capabilities: { dispatch: true } }));
      const finish = async (run, id, text) => {
        emit(run, { status: 'waiting_reply', turnCompleted: true, reply: { id, text } });
        await api.flushRuntime();
      };
      let taskId, other;
      if (received) {
        const ref = { noteId: 'route', lineIndex: 0, selection: makeSelection(body, body.indexOf(quote), body.length) };
        const origin = { key: noteSelectionTaskKey(ref, quote), title: '旅行准备', noteSource: ref, dispatch: { agentId: 'codex', logic: [] } };
        taskId = ok(await api.createTaskWithAttachments(quote, [], projectId, origin)).taskId;
        ok(await api.dispatchProjectTask(projectId, taskId, 'codex'));
        await finish(runs[0], 'v1', '第一版建议在大阪换乘。');
        other = ok(await api.createProject({ name: '工作安排' })).projectId;
      }
      window.inboxTest = { api, base, other, projectId, taskId, runs, finish, emit };
      return api;
    }
    let ready;
    const get = () => ready ??= backend();
    window.quandeckDesktop = {
      platform: 'darwin', bootstrap: async () => { await get(); return {}; },
      getConnection: async () => ({ baseUrl: 'http://127.0.0.1:9099', token: '' }),
      command: async (name, args) => (await get())[name](...args),
      onSnapshot: callback => window.inboxTest.api.subscribe(callback),
      onNavigate: () => () => {}, onStorageError: () => () => {},
      readKnowledge: async () => localStorage.getItem(key),
      compareKnowledge: async (old, next) => {
        if (localStorage.getItem(key) !== old) return false;
        localStorage.setItem(key, next); return true;
      },
      savePreference: async (k, value) => localStorage.setItem(k, value),
    };
  }, { received });
}
