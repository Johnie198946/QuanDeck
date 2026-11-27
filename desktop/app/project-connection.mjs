/** Task-specific connections can open only their selected task scope. Previous runs
 * retain their own connection when the selected source or app profile changes. */
export function projectConnectionForRun(snapshot, connectionId, taskId, workItemId) {
  if (!snapshot || typeof connectionId !== 'string' || !connectionId) return undefined;
  const selected = taskId && (snapshot.orchestrations?.[taskId]?.items?.[workItemId]?.sourceDirectory || snapshot.tasks?.[taskId]?.sourceDirectory);
  const current = Object.values(selected?.bindings ?? snapshot.runtimeConnections ?? {}).find(value =>
    value.connectionId === connectionId && (!selected || value.projectPath === selected.path));
  if (current) return current;
  return Object.values(snapshot.sessions ?? {}).map(session => session.runtime).find(runtime =>
    runtime?.connection?.connectionId === connectionId && (!taskId || runtime.taskId === taskId && runtime.workItemId === workItemId))?.connection;
}
