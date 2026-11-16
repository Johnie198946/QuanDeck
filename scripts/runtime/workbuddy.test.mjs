import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeService } from '../agent-bridge.mjs';
import { detectWorkBuddy } from './workbuddy.mjs';

test('WorkBuddy opens the detected desktop app without passing a prompt or claiming execution', async () => {
  let app = { app: '/Applications/WorkBuddy.app', version: '5.11.3' };
  const launches = [];
  const service = createBridgeService({
    platform: 'darwin',
    detectWorkBuddy: async () => app,
    openWorkBuddy: async (...args) => launches.push(args),
    findBinary: async () => null,
    validDirectory: async () => '/verified/project',
  });
  try {
    const { tools } = await service.tools();
    assert.equal(tools.find(tool => tool.tool === 'workbuddy')?.version, '5.11.3');
    const receipt = await service.test({ tool: 'workbuddy', projectPath: '/project' });
    assert.equal(receipt.projectPath, '/verified/project');
    assert.equal(receipt.desktopVersion, '5.11.3');
    assert.equal(receipt.discussionOpen, true);
    assert.equal(receipt.login, 'unknown');
    assert.ok(Object.values(receipt.capabilities).every(value => value === false));
    assert.deepEqual(launches, []);
    const result = await service.discuss({ connectionId: receipt.connectionId });
    assert.equal(result.status, 'opened');
    assert.equal(result.needsPaste, true);
    assert.deepEqual(launches, [[app.app]]);
    app = null;
    await assert.rejects(service.discuss({ connectionId: receipt.connectionId }), /未找到可用的 WorkBuddy/);
    assert.equal(launches.length, 1);
  } finally {
    await service.runtime.close();
  }
});

test('unsupported platforms do not advertise a WorkBuddy client', async () => {
  assert.equal(await detectWorkBuddy({ platform: 'win32' }), null);
});
