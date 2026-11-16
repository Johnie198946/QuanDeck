import { dashboardOverview } from './dashboard';
import type { OverviewBucket } from './dashboard';
import { completedResults } from './results';
import { instant } from './timeline';
import type { Snapshot } from './types';

export type ProjectFilter = 'all' | 'active' | 'attention' | 'done';

/** A project owns its own snapshot. Duplicate project references never inflate totals. */
export function portfolioOverview(snapshots: Snapshot[]) {
  const unique = new Map(snapshots.filter(snap => snap.project.id).map(snap => [snap.project.id, snap]));
  const projects = [...unique.values()].map(snap => {
    const overview = dashboardOverview(snap);
    const reports = overview.rows.flatMap(row => completedResults(snap, row.task.id, null).map(report => {
      let timestamp = Number.NaN;
      try { timestamp = Date.parse(instant(report.at, snap.date, snap.project.timeZone)); } catch { /* A missing source time remains unknown. */ }
      return { ...report, taskId: row.task.id, taskTitle: row.task.title, projectId: snap.project.id, projectName: snap.project.name, timestamp };
    }));
    const total = overview.rows.length;
    const done = overview.counts.done;
    const finished = total > 0 && done === total;
    return { snap, id: snap.project.id, name: snap.project.name, total, done, counts: overview.counts, reports,
      finished, hasAttention: overview.counts.attention > 0, completion: total ? done / total : null };
  });
  const counts: Record<OverviewBucket, number> = { running: 0, attention: 0, pending: 0, done: 0, cancelled: 0 };
  for (const project of projects) for (const bucket of Object.keys(counts) as OverviewBucket[]) counts[bucket] += project.counts[bucket];
  const reports = projects.flatMap(project => project.reports).sort((a, b) => {
    const av = Number.isFinite(a.timestamp), bv = Number.isFinite(b.timestamp);
    return av && bv ? b.timestamp - a.timestamp : av ? -1 : bv ? 1 : 0;
  });
  const humanReports = reports.filter(report => report.origin === 'human').length;
  const agentReports = reports.filter(report => report.origin === 'agent' || report.origin == null && !!(report.agentId || report.sessionId || report.attemptId)).length;
  return { projects, counts, reports, humanReports, agentReports, unknownReports: reports.length - humanReports - agentReports,
    totalTasks: projects.reduce((sum, project) => sum + project.total, 0),
    completedProjects: projects.filter(project => project.finished).length,
    attentionProjects: projects.filter(project => project.hasAttention).length };
}

export function matchesProjectFilter(project: ReturnType<typeof portfolioOverview>['projects'][number], filter: ProjectFilter) {
  return filter === 'all' || filter === 'active' && !project.finished || filter === 'attention' && project.hasAttention || filter === 'done' && project.finished;
}
