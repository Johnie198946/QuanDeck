/** A cache entry is disposable only when every known owner is being erased.
 * Inspect IDs, never directory prefixes: shared profiles and historical sources count. */
export function connectionIdsIn(value, found=new Set()) {
  if(!value || typeof value!=='object')return found;
  for(const [key,entry]of Object.entries(value)) {
    if(key==='connectionId' && typeof entry==='string')found.add(entry);
    else if((key==='connectionIds'||key==='allowedFallbackConnectionIds')&&Array.isArray(entry)){for(const id of entry)if(typeof id==='string')found.add(id);}
    else if(entry && typeof entry==='object')connectionIdsIn(entry,found);
  }
  return found;
}
export function removableProjectConnections({library,runs=[],profiles=[],connections=[],projectIds,candidates=[],preserve=[]}) {
  const removed=new Set(projectIds),selected=new Set(candidates),retained=new Set(preserve);
  for(const [id,snapshot]of Object.entries(library?.projects??{}))connectionIdsIn(snapshot,removed.has(id)?selected:retained);
  connectionIdsIn(profiles,retained);
  connectionIdsIn(runs.filter(run=>!removed.has(run.projectId)),retained);
  let size;do {size=retained.size;for(const connection of connections)if(!selected.has(connection.connectionId)||retained.has(connection.connectionId))connectionIdsIn(connection,retained);}while(retained.size!==size);
  return [...selected].filter(id=>!retained.has(id));
}
