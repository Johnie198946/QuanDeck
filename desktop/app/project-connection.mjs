/** Project-local transport lookup. Running sessions keep the connection they
 * started with even when the application profile changes for future work. */
export function projectConnectionForRun(snapshot, connectionId) {
  if (!snapshot || typeof connectionId !== 'string' || !connectionId) return undefined;
  return Object.values(snapshot.runtimeConnections ?? {}).find(value => value.connectionId === connectionId)
    ?? Object.values(snapshot.sessions ?? {}).map(session => session.runtime?.connection)
      .find(value => value?.connectionId === connectionId);
}
