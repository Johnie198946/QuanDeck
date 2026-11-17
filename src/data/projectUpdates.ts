import type { Snapshot } from './types';

export interface ProjectUpdates {
  projectIds: string[];
  revisions: Record<string, string>;
  snapshots: Snapshot[];
}

/** Read cursors are not business versions or authorization tokens. A new backend
 * lifetime changes the namespace, including when a backup restores old versions. */
export class ProjectUpdateReader {
  private readonly namespace = crypto.randomUUID();
  private readonly revisions = new WeakMap<Snapshot, string>();
  private sequence = 0;

  read(projects: Snapshot[], known: Record<string, string> = {}, read?: (id: string) => Snapshot): ProjectUpdates {
    if (!known || typeof known !== 'object' || Array.isArray(known) || Object.keys(known).length > 10000 ||
      Object.values(known).some(value => typeof value !== 'string' || value.length > 120)) throw Error('项目读取游标无效');
    const current = projects.filter(project => !project.project.deletedAt && project.project.id);
    const revisions: Record<string, string> = Object.create(null);
    const snapshots: Snapshot[] = [];
    for (const project of current) {
      const id = project.project.id;
      let revision = this.revisions.get(project);
      if (!revision) { revision = `${this.namespace}:${++this.sequence}`; this.revisions.set(project, revision); }
      revisions[id] = revision;
      if (known[id] !== revision) snapshots.push(read ? read(id) : structuredClone(project));
    }
    return { projectIds: current.map(project => project.project.id), revisions, snapshots };
  }
}

/** Keep unrelated project objects stable. Full membership also removes deleted
 * projects; changed snapshots never silently revive a removed project. */
export function mergeProjectUpdates(previous: Snapshot[], update: ProjectUpdates): Snapshot[] {
  const items = new Map(previous.map(project => [project.project.id, project]));
  for (const project of update.snapshots) items.set(project.project.id, project);
  const next = update.projectIds.map(id => {
    const value = items.get(id);
    if (!value) throw Error('项目增量数据不完整，请重新读取');
    return value;
  });
  return next.length === previous.length && next.every((value, index) => value === previous[index]) ? previous : next;
}

interface ProjectUpdateSource {
  listProjects(): Promise<Snapshot[]>;
  readProjectUpdates?(known: Record<string, string>): Promise<ProjectUpdates>;
}

/** Coalesce bursts without dropping a change received during an in-flight read. */
export function createProjectSnapshotSync(source: ProjectUpdateSource, changed: (projects: Snapshot[]) => void) {
  let projects: Snapshot[] = [], known: Record<string, string> = {};
  let pending: Promise<void> | null = null, dirty = false, disposed = false;
  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    dirty = true;
    if (pending) return pending;
    pending = (async () => {
      while (dirty && !disposed) {
        dirty = false;
        let next: Snapshot[];
        if (source.readProjectUpdates) {
          const update = await source.readProjectUpdates(known);
          if (disposed) return;
          next = mergeProjectUpdates(projects, update);
          known = update.revisions;
        } else {
          // Compatibility with remote servers predating the incremental endpoint.
          const values = await source.listProjects();
          if (disposed) return;
          const old = new Map(projects.map(project => [project.project.id, project]));
          next = values.map(value => {
            const prior = old.get(value.project.id);
            return prior?.version === value.version && prior.lastSync === value.lastSync ? prior : value;
          });
          if (next.length === projects.length && next.every((value, index) => value === projects[index])) next = projects;
        }
        if (next !== projects) { projects = next; changed(next); }
      }
    })().finally(() => { pending = null; });
    return pending;
  };
  return { refresh, dispose: () => { disposed = true; } };
}
