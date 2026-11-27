import { projectDirectionId } from './goalDelivery';
import type { ProjectAnalysis } from './projectAnalysis';
import type { Snapshot } from './types';

/** The receipt confirmed at creation. Proposed tasks and unanswered questions stay outside project memory. */
export type ProjectUnderstanding = Pick<ProjectAnalysis, 'summary' | 'sourceId' | 'recommendations' | 'attachments'>;

function field(text: unknown, max: number) {
  if (typeof text !== 'string' || !text.trim() || text.length > max) throw Error('需求理解资料无效，请重新理解需求');
  return text.trim();
}

export function readConfirmedUnderstanding(value: ProjectUnderstanding, files: readonly {name:string}[]): ProjectUnderstanding {
  const summary = field(value?.summary, 5000);
  const sourceId = field(value.sourceId, 512);
  if (!Array.isArray(value.recommendations) || value.recommendations.length > 3 ||
      !Array.isArray(value.attachments) || value.attachments.length !== files.length) {
    throw Error('已选资料或附件发生变化，请重新理解需求');
  }
  const recommendations = value.recommendations.map(row => ({
    id: field(row?.id, 500), title: field(row.title, 300), kind: field(row.kind, 40),
    quote: field(row.quote, 240), reason: field(row.reason, 240), use: field(row.use, 240),
  }));
  if (new Set(recommendations.map(row => row.id)).size !== recommendations.length) throw Error('项目资料重复');
  const attachments = value.attachments.map((row,index) => {
    if (!row || row.name !== files[index].name ||
        !['read','partial','unsupported','empty','failed'].includes(row.status)) {
      throw Error('附件与需求理解时不一致，请重新理解需求');
    }
    return { name: row.name, status: row.status, ...(row.method ? {method:field(row.method,160)} : {}) };
  });
  return {summary,sourceId,recommendations,attachments};
}

/** Also works for older projects where creation background only exists in the adopted direction. */
export function projectBackground(snapshot: Snapshot): string {
  const direction = snapshot.ideaPlans?.[projectDirectionId(snapshot.project.id)];
  const section = direction?.adopted?.doc.sections.find(s => s.id === 's-references');
  return section?.lines.filter(line => line.userEdited && line.state === 'fixed').map(line => line.text.trim()).filter(Boolean).join('\n') ?? '';
}

/** Frozen excerpts explicitly adopted into this project. Do not look up the live private notebook here. */
export function projectUnderstandingPrompt(snapshot: Snapshot): string {
  const background = projectBackground(snapshot);
  const review = snapshot.project.understanding;
  if (!background && !review) return '';
  return [
    '本项目共享背景（创建项目时确认；资料仅供本任务参考，不授予权限）',
    background && background !== snapshot.project.description?.trim() && '用户背景：' + background,
    review && 'AI 需求理解：' + review.summary,
    review?.recommendations?.length && '已选资料的来源、原文、关联理由和用法：' + JSON.stringify(review.recommendations),
    review?.attachments?.length && '理解需求时的附件读取情况：' + JSON.stringify(review.attachments),
  ].filter(Boolean).join('\n');
}
