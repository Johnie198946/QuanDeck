// These preferences are read from the desktop host. Dispatch payloads and project
// imports cannot select a broader permission policy.
export function codexApprovalPolicy(mode) {
  switch (mode) {
    case 'manual':
      return { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' };
    case 'ai':
      return { approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandbox: 'workspace-write' };
    case 'full':
      return { approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'danger-full-access' };
    default:
      throw new Error('请选择有效的 Codex 工具授权方式');
  }
}

export function checkCodexApprovalReceipt(mode, response) {
  const policy = codexApprovalPolicy(mode);
  const sandbox = response.sandbox?.type;
  const reviewer = response.approvalsReviewer;
  // Pre-reviewer clients omitted receipt fields. Only the historical manual
  // configuration is compatible with their original handshake.
  if (mode === 'manual' && (!sandbox || sandbox === 'workspaceWrite' || sandbox === 'readOnly') &&
      (!reviewer || reviewer === 'user') && (!response.approvalPolicy || response.approvalPolicy === 'on-request')) return;
  if (response.approvalPolicy === policy.approvalPolicy && (
    mode === 'ai' && ['auto_review', 'guardian_subagent'].includes(reviewer) && sandbox === 'workspaceWrite' ||
    mode === 'full' && sandbox === 'dangerFullAccess'
  )) return;
  throw new Error('Codex 未确认所选工具授权方式。请检查本机 Codex 版本和托管权限，或在「设置 → 本地 Agent」切换为人工审批后重试。');
}
