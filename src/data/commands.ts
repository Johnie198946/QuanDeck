/** Explicit IPC allowlist. Internal runtime mutation and arbitrary method access are never exposed. */
export const BUSINESS_COMMANDS = [
  'integrate', 'reviewIntegration', 'queryTaskMemory', 'readTaskEvidence',
  'summarizeTaskTitle', 'submitIntake', 'retryIntake', 'resolveSuggestion', 'refreshProjectSummary', 'collaborate', 'startReview', 'load', 'listProjects', 'createProject', 'switchProject', 'updateProject', 'createTaskWithAttachments', 'setTaskAttachments', 'saveTaskOutput', 'deleteTaskOutput',
  'addManualSubtask', 'setTaskOwner', 'updateJournal', 'addBlock', 'updateText', 'deleteBlock', 'updateTaskTitle', 'convertTextToTask',
  'dispatch', 'cancelDispatch', 'reconcile', 'retryDispatch', 'completeTask', 'reopenTask', 'resumeAutoFollow', 'linkSession', 'createTaskFromSession',
  'setTracked', 'toggleStar', 'togglePin', 'setDefaultAgent', 'registerAgent', 'scanAgent', 'createIdea', 'ensureTaskPlan', 'setDiscussionAgent',
  'recordDiscussionConclusion', 'adoptDiscussionConclusion', 'editPlanLine', 'generateDrafts', 'updateDraft', 'removeDraft', 'mergeDraftUp',
  'indentDraft', 'addDraftsToTasks', 'openLocalPlan', 'resolveConflict', 'setWorkOwner', 'setWorkStatus', 'dispatchWork', 'applyRevision',
  'addCustomAgent', 'updateCustomAgent', 'removeCustomAgent', 'addPlan', 'removePlan', 'setPlanTimer', 'applyPlanMoves', 'manageNow',
  'bindRuntimeConnection', 'startDiscussion', 'controlSession', 'syncRuntime', 'prepareSourceSession',
] as const;
