import type { RuntimeConnectionBinding } from './runtimeContracts';
import type { Snapshot } from './types';

export interface TaskSourceDirectory {
  path: string;
  bindings: Record<string, RuntimeConnectionBinding>;
}

export function sourceOwner(snapshot:Snapshot, taskId:string, itemId?:string) {
  return itemId ? snapshot.orchestrations?.[taskId]?.items[itemId] : snapshot.tasks[taskId];
}

export function taskSourceDirectory(snapshot:Snapshot, taskId:string, itemId?:string) {
  return sourceOwner(snapshot,taskId,itemId)?.sourceDirectory ?? snapshot.tasks[taskId]?.sourceDirectory;
}

export function taskConnection(snapshot:Snapshot, taskId:string, agentId:string, itemId?:string) {
  const selected = taskSourceDirectory(snapshot,taskId,itemId);
  return selected ? selected.bindings[agentId] : snapshot.runtimeConnections?.[agentId];
}
