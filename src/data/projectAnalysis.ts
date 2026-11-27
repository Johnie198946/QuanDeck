import type { TaskDraft } from './types';
import { readPlanTasks } from './projectWorkflow';

export interface ProjectAnalysisInput {
  goal: string; information: string;
  name?: string; deadline?: string; previousQuestions?: string[];
  files?: {name: string; type: string; bytes: ArrayBuffer}[];
  taskId?: string; projectId?: string; itemId?: string;
}
export interface ProjectKnowledgeCandidate {
  id: string; title: string; kind: string; excerpt: string;
}
export interface ProjectRecommendation extends Omit<ProjectKnowledgeCandidate, 'excerpt'> {
  quote: string; reason: string; use: string;
}
export interface ProjectAttachmentCoverage {
  name: string;
  status: 'read' | 'partial' | 'empty' | 'unsupported' | 'failed';
  method?: string;
}
export interface ProjectAnalysis {
  summary: string;
  questions: string[];
  tasks: TaskDraft[];
  recommendations?: ProjectRecommendation[];
  attachments?: ProjectAttachmentCoverage[];
  sourceId: string;
}
const text = {type:'string'};
export const projectAnalysisSchema = {
  type:'object', additionalProperties:false, required:['summary','questions','tasks'],
  properties:{
    summary:text, questions:{type:'array',items:text},
    tasks:{type:'array',items:{type:'object',additionalProperties:false,
      required:['key','title','expected','deps','parentKey'],
      properties:{key:text,title:text,expected:text,parentKey:text,deps:{type:'array',items:text}}}
    }
  }
};

export function readProjectAnalysis(value: unknown, sourceId: string, research: boolean): ProjectAnalysis {
  if (!value || typeof value !== 'object' || !sourceId) throw Error('未收到可核对的 AI 回复');
  const row = value as Record<string,unknown>;
  if (typeof row.summary !== 'string' || !row.summary.trim() || row.summary.length > 5000 ||
    !Array.isArray(row.questions) || row.questions.length > 5 || row.questions.some(item => typeof item !== 'string' || item.length > 360) ||
    !Array.isArray(row.tasks) || row.tasks.length > 30)
    throw Error('AI 回复格式有误，请重试');
  return {summary:row.summary.trim(), questions:row.questions.filter(text=>text.trim()), sourceId, tasks: research ? [] :
    (readPlanTasks(row.tasks.map(task => ({...task,parentKey:task?.parentKey || undefined,owner:'unassigned'}))) ?? [])};
}
