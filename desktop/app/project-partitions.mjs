export const PROJECT_LIBRARY_KEY = 'quandeck.projects.v1';
export const PROJECT_PARTITIONS_FORMAT = 'project-partitions-v1';

/** Compatibility/export boundary only. Normal project reads use one physical row. */
export function readStoredProjectLibrary(db) {
  const row = db.prepare('SELECT value FROM documents WHERE key=?').get(PROJECT_LIBRARY_KEY);
  if (!row) return undefined;
  const value = JSON.parse(row.value);
  if (value.storage !== PROJECT_PARTITIONS_FORMAT) return value;
  if (!Array.isArray(value.projectIds) || new Set(value.projectIds).size !== value.projectIds.length) throw Error('项目目录无效');
  const { storage, projectIds, ...metadata } = value;
  const rows = new Map(db.prepare('SELECT project,value FROM project_documents').all().map(row => [row.project, row.value]));
  if (rows.size !== projectIds.length || projectIds.some(id => !rows.has(id))) throw Error('项目分区与目录不一致，未覆盖原数据');
  return { ...metadata, projects: Object.fromEntries(projectIds.map(id => [id, JSON.parse(rows.get(id))])) };
}

export function readStoredProject(db, projectId) {
  const row = db.prepare('SELECT value FROM project_documents WHERE project=?').get(projectId);
  return row ? JSON.parse(row.value) : undefined;
}
