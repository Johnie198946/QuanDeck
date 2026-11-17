import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalChoices, chooseApproval, publicApprovalChoices } from './approval-options.mjs';
const method = 'item/commandExecution/requestApproval';
const rule = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git', 'status'] } };
const network = { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'example.com', action: 'allow' } } };
test('source ordering and exact command/network rules survive without exposing wire values to the client', () => {
 const decisions = ['decline', rule, 'acceptForSession', network, 'accept', 'cancel'];
 const options = approvalChoices('codex', method, { availableDecisions: decisions });
 assert.deepEqual(options.map(option => option.response.decision), decisions);
 assert.deepEqual(options.map(option => option.scope), ['deny','rule','session','rule','once','cancel']);
 assert.ok(publicApprovalChoices(options).every(option => !('response' in option)));
 for (const option of options) assert.deepEqual(chooseApproval(options, { approvalOptionId: option.id }).response, option.response);
});
test('explicit source allow-list prevents broadened choices and invented client rules', () => {
 const options = approvalChoices('codex', method, { availableDecisions: ['decline'], proposedExecpolicyAmendment: ['git'] });
 assert.equal(options.length, 1);
 assert.throws(() => chooseApproval(options, { decision: 'allowed-once' }), /未提供/);
 assert.throws(() => chooseApproval(options, { decision: 'acceptForSession' }), /未提供/);
 assert.throws(() => chooseApproval(options, { approvalOptionId: 'source-2', response: { decision: rule } }), /未提供/);
 assert.deepEqual(approvalChoices('codex', method, { availableDecisions: [] }), []);
 assert.deepEqual(approvalChoices('codex', method, { availableDecisions: true }), []);
});
test('older Codex requests use supported defaults and only source-proposed amendments', () => {
 const options=approvalChoices('codex',method,{proposedExecpolicyAmendment:['npm','test'],proposedNetworkPolicyAmendments:[{host:'example.com',action:'deny'}]});
 assert.deepEqual(options.map(o=>o.scope),['once','session','deny','cancel','rule','rule']);
 assert.deepEqual(options[4].response.decision.acceptWithExecpolicyAmendment.execpolicy_amendment,['npm','test']);
 assert.equal(options[5].label,'记住此网站的拒绝规则');
});
test('unsupported/malformed decisions cannot become grant buttons', () => {
 const invalid = ['acceptForever',{}, { acceptWithExecpolicyAmendment: { execpolicy_amendment: [] } },{ applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'example.com', action: 'anything' } } }];
 assert.deepEqual(approvalChoices('codex',method,{availableDecisions:invalid}),[]);
 const file=approvalChoices('codex','item/fileChange/requestApproval',{availableDecisions:['acceptForSession',rule]});
 assert.deepEqual(file.map(o=>o.scope),['session']);
});
test('Claude and DSH do not inherit unverified Codex session or rule permissions', () => {
 for(const [tool,method] of [['dsh','approval/request'],['claude','item/commandExecution/requestApproval']]) {
  const options=approvalChoices(tool,method,{availableDecisions:['acceptForSession',rule]});
  assert.deepEqual(options.map(o=>o.scope),['once','deny','cancel']);
  assert.deepEqual(chooseApproval(options,{decision:'allowed-once'}).response, tool==='dsh'?{outcome:'allowed-once'}:{decision:'accept'});
 }
});
test('permission profiles grant only the source profile with explicit turn/session scope, deny sends no permissions', () => {
 const profile={network:null,fileSystem:{read:['/project'],write:null}};
 const choices=approvalChoices('codex','item/permissions/requestApproval',{permissions:profile});
 assert.deepEqual(choices.map(c=>c.scope),['turn','session','deny']);
 assert.deepEqual(choices[0].response,{permissions:{fileSystem:profile.fileSystem},scope:'turn'});
 assert.deepEqual(choices[1].response,{permissions:{fileSystem:profile.fileSystem},scope:'session'});
 assert.deepEqual(choices[2].response,{permissions:{},scope:'turn'});
 assert.deepEqual(approvalChoices('codex','item/permissions/requestApproval',{permissions:{anything:true}}).map(c=>c.scope),['deny']);
 assert.deepEqual(approvalChoices('codex','item/unknown/requestApproval',{}),[]);
});
test('permission scope details are readable and unknown permission shapes cannot be silently granted', () => {
 const profile={network:{enabled:true},fileSystem:{read:['/project'],write:null,entries:[{access:'write',path:{type:'special',value:{kind:'project_roots',subpath:'output'}}}]}};
 const options=approvalChoices('codex','item/permissions/requestApproval',{permissions:profile});
 assert.equal(options[0].rule,'网络：允许连接\n读取：/project\n写入：项目目录 / output');
 assert.deepEqual(options[0].response.permissions,profile);
 for(const permissions of [{network:{enabled:'true'}},{fileSystem:{write:'/' }},{fileSystem:{futureBroadGrant:true}}])assert.deepEqual(approvalChoices('codex','item/permissions/requestApproval',{permissions}).map(o=>o.scope),['deny']);
});
