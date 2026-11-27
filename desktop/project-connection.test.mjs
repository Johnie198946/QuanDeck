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

test('a selected source and its historical connection belong to one task only', () => {
  const source = {connectionId:'source',projectPath:'/chosen'}, old = {connectionId:'old',projectPath:'/old'};
  const project = {tasks:{a:{sourceDirectory:{path:source.projectPath,bindings:{codex:source}}},b:{}},
    sessions:{s:{runtime:{taskId:'a',connection:old}}}};
  assert.equal(projectConnectionForRun(project,'source','a'),source);
  assert.equal(projectConnectionForRun(project,'old','a'),old);
  assert.equal(projectConnectionForRun(project,'source','b'),undefined);
  assert.equal(projectConnectionForRun(project,'old','b'),undefined);
});
