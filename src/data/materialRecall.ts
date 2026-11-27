import type { OutputAttachment } from './types';
import { materialTargetKey, type MaterialTarget } from './materialUse';
import type { KnowledgeNote } from './knowledgeNotes';
import { segmentKnowledgeWords } from './knowledgeWords';
import { outcomeUrl } from './noteTodos';

export interface MaterialMatch {
  noteId: string;
  todoId: string;
  noteTitle: string;
  title: string;
  text: string;
  url?: string;
  purpose?: string;
  projectId?: string;
  files?: OutputAttachment[];
  usedBy?: MaterialTarget[];
  at: string;
  reason: string;
}

type MaterialQuery = {
  target?: MaterialTarget;
  text: string;
  projectId?: string;
  projectName?: string;
  filedOnly?: boolean;
  exclude?: { noteId: string; todoId: string };
};

const genericTerms = new Set(('材料 素材 主打 资料 文档 文件 附件 链接 参考 信息 内容 事项 任务 待办 项目 日程 ' +
  '记录 笔记 想法 整理 收集 撰写 写作 准备 编写 说明 方案 完成 已经 收到 提供 确认 核对 使用 计划 ' +
  '安排 处理 需要 今天 明天 本周 昨天 一下 一份 一个 一些 相关 发送 用来 这份 进行 编辑 同事 跟进 工作 ' +
  '修改 改成 改为 换成 变成 调整 增加 减少 移除 设置 添加 更换 改动 优化 设计 分析 要求 目前 重新 点击 ' +
  '客户 产品 更新 新建 创建 给我 帮我 materials material document notes task project write the and for with').split(' '));

function terms(value: string) {
  const result = new Set<string>();
  // Some Chinese names and component names are segmented into individual characters.
  // Recover consecutive triples while treating stops and punctuation as boundaries.
  for (const phrase of value.slice(0,5000).split(/[^\p{L}\p{N}]+/u)) {
    let singles = '';
    for (const word of segmentKnowledgeWords(phrase)) {
      if (/^[\p{Script=Han}]$/u.test(word) && !'的了做给问要写从和与向有我在把让用为对等去再找过'.includes(word)) {
        singles += word;
        if (singles.length >= 3) result.add(singles.slice(-3));
      } else {
        singles = '';
        if (word.length >= 2 && /\p{L}/u.test(word) && !genericTerms.has(word)) result.add(word);
      }
    }
  }
  return result;
}

type ProjectName = { id: string; name: string };

export function createMaterialRecall(notes: readonly KnowledgeNote[], projects: readonly ProjectName[] = []) {
  const projectVocabulary = new Map(projects.map(project => [project.id, terms(project.name)]));
  const candidates = notes.filter(note => !note.archivedAt).flatMap(note =>
    (note.todos ?? []).flatMap(todo => {
      const outcome = todo.outcome;
      if (!todo.completedAt || !outcome || (todo.followup && !todo.followup.receivedAt)) return [];
      const url = outcome.url && outcomeUrl(outcome.url);
      if (!outcome.text.trim() && !url && !outcome.files?.length) return [];
      // Filing a quote shares that paragraph. It does not grant an agent access to a later receipt.
      const filedProjects = new Set(note.projectQuotes?.filter(q =>
        q.lineIndex === todo.lineIndex && q.text === todo.text).map(q => q.projectId));
      const material = {
        noteId: note.id, todoId: todo.id, noteTitle: note.title, title: todo.text,
        text: outcome.text, url, files:outcome.files, usedBy:outcome.usedBy, purpose: outcome.purpose, projectId: outcome.projectId, at: outcome.at,
      };
      return [{ material, filedProjects, purpose: terms(outcome.purpose ?? ''), source: terms([todo.text,outcome.text,...(outcome.files ?? []).map(file=>file.name)].join(' ')),
        filenames:terms((outcome.files ?? []).map(file=>file.name).join(' ')), noteTitle: terms(note.title) }];
    }));

  return (query: MaterialQuery, limit = 3): MaterialMatch[] => {
    if (!query.text.trim() || limit <= 0) return [];
    const wanted = terms(query.text);
    const queryProjectTerms = query.projectName && !projectVocabulary.has(query.projectId ?? '') ? terms(query.projectName) : undefined;
    const matches = candidates.flatMap(candidate => {
      const { material, filedProjects } = candidate;
      if (query.filedOnly && (!query.projectId || material.projectId !== query.projectId)) return [];
      if (query.exclude?.noteId === material.noteId && query.exclude?.todoId === material.todoId) return [];
      if (query.projectId && (material.projectId ? material.projectId !== query.projectId :
          filedProjects.size && !filedProjects.has(query.projectId))) return [];
      const used = !!query.target && !!material.usedBy?.some(ref=>materialTargetKey(ref)===materialTargetKey(query.target!));
      if (used) return [{score:Infinity,match:{...material,reason:'已用于这个任务'}}];
      const sameProject = !!query.projectId && material.projectId === query.projectId;
      let score = 0;
      let best = '';
      let bestWeight = 0;
      const support: string[] = [];
      const projectTerms = material.projectId ? projectVocabulary.get(material.projectId) ?? (sameProject ? queryProjectTerms : undefined) : undefined;
      for (const term of wanted) {
        const weight = candidate.purpose.has(term) ? 6 : candidate.source.has(term) ? 4 :
          candidate.noteTitle.has(term) ? 2 : projectTerms?.has(term) ? 1 : 0;
        if (weight > 0) support.push(term);
        score += weight;
        if (weight > bestWeight) { bestWeight = weight; best = term; }
      }
      // For a material-gathering task, explicit filing is also a meaningful fallback.
      if (!score && !(sameProject && !wanted.size && /材料|素材|资料|参考|文档|附件|material|document/iu.test(query.text))) return [];
      // One short incidental word in a multi-topic request is weak evidence. A
      // direct use, explicit purpose, exact project name or corroborating term is stronger.
      if (support.length === 1 && wanted.size > 2 && bestWeight !== 6 &&
          /^[\p{Script=Han}]{2}$/u.test(best) && !projectTerms?.has(best) && !candidate.filenames.has(best)) return [];
      const reason = best ? (bestWeight === 6 ? '预留用途含「' : '同样提到「') + best + '」' : '已归入这个项目';
      return [{ score: score + Number(sameProject), match: { ...material, reason } }];
    });
    return matches.sort((a,b) => b.score - a.score || b.match.at.localeCompare(a.match.at) ||
      a.match.noteId.localeCompare(b.match.noteId) || a.match.todoId.localeCompare(b.match.todoId))
      .slice(0, limit).map(item => item.match);
  };
}

export function recallMaterials(notes: readonly KnowledgeNote[], query: MaterialQuery, limit = 3) {
  return createMaterialRecall(notes)(query, limit);
}

/** Past requests are leads for the human, never evidence for an agent prompt. */
export function unrecordedRequests(notes:readonly KnowledgeNote[], query:MaterialQuery) {
  if (!query.projectId || !/(材料|资料|数据|报告|素材|文件|清单|参考|文档)/u.test(query.text)) return [];
  return notes.filter(n=>!n.archivedAt).flatMap(note=>(note.todos ?? []).flatMap(todo=>{
    if (!todo.completedAt || todo.outcome?.text || todo.outcome?.url || todo.outcome?.files?.length ||
        !/(问|找|向|要|索取|收集|获取|申请|请)/u.test(todo.text) ||
        !/(材料|资料|数据|报告|素材|文件|清单|文档)/u.test(todo.text)) return [];
    if (query.exclude?.noteId===note.id && query.exclude.todoId===todo.id) return [];
    const filed=note.projectQuotes?.some(q=>q.projectId===query.projectId && q.text===todo.text && q.lineIndex===todo.lineIndex);
    if (!filed) return [];
    return [{title:todo.text,noteId:note.id,todoId:todo.id,at:todo.completedAt}];
  })).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,3);
}
