/** Explicit IPC allowlist. Internal runtime mutation and arbitrary method access are never exposed. */
export const BUSINESS_COMMANDS = [
  'getQualityCostReport', 'exportTaskRevisions', 'previewTaskRevisions', 'importTaskRevisions',
  'integrate', 'reviewIntegration', 'queryTaskMemory', 'readTaskEvidence',
  'summarizeTaskTitle', 'submitIntake', 'retryIntake', 'resolveSuggestion', 'refreshProjectSummary', 'collaborate', 'startReview', 'load', 'listProjects', 'createProject', 'switchProject', 'updateProject', 'deleteProject', 'deleteTask', 'createTaskWithAttachments', 'setTaskAttachments', 'saveTaskOutput', 'deleteTaskOutput',
  'addManualSubtask', 'setTaskOwner', 'updateJournal', 'addBlock', 'updateText', 'deleteBlock', 'updateTaskTitle', 'addTaskInput', 'convertTextToTask',
  'dispatch', 'cancelDispatch', 'reconcile', 'retryDispatch', 'completeTask', 'reopenTask', 'resumeAutoFollow', 'linkSession', 'createTaskFromSession',
  'setTracked', 'toggleStar', 'togglePin', 'setDefaultAgent', 'registerAgent', 'scanAgent', 'createIdea', 'ensureTaskPlan', 'ensureProjectPlan', 'savePlanOutline', 'configureGoalAutomation', 'setDiscussionAgent',
  'recordDiscussionConclusion', 'adoptDiscussionConclusion', 'approvePlan', 'recordPlanConfirmation', 'recordDiscussionFeedback', 'editPlanLine', 'generateDrafts', 'updateDraft', 'removeDraft', 'mergeDraftUp',
  'indentDraft', 'addDraftsToTasks', 'openLocalPlan', 'resolveConflict', 'setWorkOwner', 'setWorkStatus', 'dispatchWork', 'applyRevision',
  'addCustomAgent', 'updateCustomAgent', 'removeCustomAgent', 'addPlan', 'removePlan', 'setPlanTimer', 'applyPlanMoves', 'manageNow',
  'dispatchProjectTask', 'bindRuntimeConnection', 'startDiscussion', 'controlSession', 'handoffSession', 'syncRuntime', 'prepareSourceSession',
] as const;
