import test from 'node:test';
import assert from 'node:assert/strict';
import { projectConnectionForRun } from './app/project-connection.mjs';

test('new shared profile does not orphan an existing run attachment directory', () => {
  const old = {connectionId:'old',projectPath:'/project-a'}, current = {connectionId:'new',projectPath:'/project-a'};
  const project = {runtimeConnections:{codex:current},sessions:{running:{runtime:{connection:old}}}};
  assert.equal(projectConnectionForRun(project,'old'),old);
  assert.equal(projectConnectionForRun(project,'new'),current);
  assert.equal(projectConnectionForRun(project,'other-project'),undefined);
  assert.equal(projectConnectionForRun(undefined,'old'),undefined);
  assert.equal(projectConnectionForRun(project,''),undefined);
});
