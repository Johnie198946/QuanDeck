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
  /** A continuous excerpt from the matched field of this receipt. */
  excerpt: string;
}

type MaterialQuery = {
  target?: MaterialTarget;
  text: string;
  context?: string;
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

// These actions and broad descriptors can support a subject but cannot establish one.
const supportingTerms = new Set(('反馈 回复 验收 交付 结果 记录 总结 开发 实现 操作 流程 页面 界面 风格 样式 颜色 方式 效果 功能 ' +
  '部分 方面 原来 现在 后续 一致 示例 最终 初稿 版本 设计 测试 检查 内容 查看 展开 收起 打开 切换 点击 拖动 旋转 缩放 ' +
  '形式 状态 数据 清单 明细 名称 模式 类型 文件名 文本 说明 表格 支持 获取 代码 修改 前端 后端 ' +
  'release update file pdf png jpg jpeg webp doc docx xls xlsx zip md txt json').split(' '));

// Conservative lexical alternatives are evidence of the same subject. Retain the actual
// spelling from each side so the user can check a match against the source text.
const equivalentTerms = [
  ['关系图','关系网络','关系网'], ['知识图谱','知识网络','knowledge graph'],
  ['球面','球形','球状'], ['三维','3d'], ['缩放','放大缩小'], ['收起','折叠'],
  ['酒店','旅馆','宾馆'], ['住宿','留宿'], ['预订','预定'], ['入场','进场'],
  ['付款','支付'], ['发货','发运'], ['库存','存货'], ['报销','报账'],
  ['登录','登入'], ['备份','备存'], ['检索','搜索'],
];
const equivalents = new Map(equivalentTerms.flatMap(group => group.map(word => [word,group[0]] as const)));
const aliasPattern = new RegExp([...equivalents.keys()].sort((a,b)=>b.length-a.length).map(word=>
  /^[a-z0-9 ]+$/.test(word) ? '\\b'+word+'\\b' : word).join('|'),'gu');

function terms(value: string) {
  const result = new Map<string,string>();
  const remaining = value.normalize('NFKC').toLowerCase().slice(0,16000)
    .replace(/!?\[[^\]\n]*\]\(<?(?:attachment:|https?:\/\/)[^)\n]+\)|https?:\/\/[^\s，。；]+|attachment:[\w-]+/giu, ' ')
    .replace(aliasPattern, word => {result.set(equivalents.get(word)!,word);return ' ';})
    // A named correspondent can be split entirely into characters by some ICU versions.
    // Recover the bounded name from a request or reply label, never sliding pieces of prose.
    .replace(/(?:请|向|找|联系|询问)([\p{Script=Han}]{2,4})(?=发回|发来|回信|索取)|^([\p{Script=Han}]{2,4})(?=(?:反馈|回复|回信)[。！]?\s*$)/gu,
      (label,recipient:string|undefined,author:string|undefined) => {
        const name = recipient ?? author;
        if (!name || genericTerms.has(name) || supportingTerms.has(name)) return label;
        result.set(name,name);
        return ' ';
      });
  for (const phrase of remaining.split(/[^\p{L}\p{N}]+/u)) {
    for (const word of segmentKnowledgeWords(phrase)) {
      if (word.length >= 2 && /\p{L}/u.test(word) && !genericTerms.has(word)) result.set(word,word);
    }
  }
  return result;
}

type EvidenceField = '结果说明'|'原待办'|'预留用途'|'附件名';
function passages(value: string, field: EvidenceField) {
  const result = [];
  // A word in the introduction and another in an unrelated appendix are not a supporting quote.
  for (const sentence of value.trim().match(/[^\r\n。！？；!?;]+[。！？；!?;]?/gu) ?? []) {
    for (let start=0; start<sentence.length; start+=128) {
      const excerpt = sentence.slice(start,start+160).trim();
      if (excerpt) result.push({field,excerpt,terms:terms(excerpt)});
      if (start+160 >= sentence.length) break;
    }
  }
  return result;
}

type ProjectName = { id: string; name: string };
export function createMaterialRecall(notes: readonly KnowledgeNote[], projects: readonly ProjectName[] = []) {
  const projectNames = new Map(projects.map(project => [project.id,project.name.trim()]));
  const candidates = notes.filter(note => !note.archivedAt).flatMap(note =>
    (note.todos ?? []).flatMap(todo => {
      const outcome = todo.outcome;
      if (!todo.completedAt || !outcome || (todo.followup && !todo.followup.receivedAt)) return [];
      const url = outcome.url && outcomeUrl(outcome.url);
      if (!outcome.text.trim() && !url && !outcome.files?.length) return [];
      // Filing the original paragraph does not grant an agent access to its later receipt.
      const filedProjects = new Set(note.projectQuotes?.filter(q =>
        q.lineIndex === todo.lineIndex && q.text === todo.text).map(q => q.projectId));
      const material = {
        noteId: note.id, todoId: todo.id, noteTitle: note.title, title: todo.text,
        text: outcome.text, url, files:outcome.files, usedBy:outcome.usedBy, purpose: outcome.purpose, projectId: outcome.projectId, at: outcome.at,
      };
      const evidence = [...passages(outcome.text,'结果说明'), ...passages(todo.text,'原待办'),
        ...passages(outcome.purpose ?? '','预留用途'), ...(outcome.files ?? []).flatMap(file=>passages(file.name,'附件名'))];
      return [{material,filedProjects,evidence}];
    }));

  return (query: MaterialQuery, limit = 3): MaterialMatch[] => {
    if (!query.text.trim() || limit <= 0) return [];
    const wanted = terms(query.text), context = terms(query.context ?? '');
    const subjects = [...wanted.keys()].filter(term => !supportingTerms.has(term));
    const gathering = /材料|素材|资料|参考|文档|附件|material|document/iu.test(query.text);
    const asksForMaterials = gathering && /整理|收集|盘点|汇总|查找|寻找|列出|查看|搜集|\b(?:find|gather|collect|list)\b/iu.test(query.text);
    const matches = candidates.flatMap(({material,filedProjects,evidence}) => {
      if (query.filedOnly && (!query.projectId || material.projectId !== query.projectId)) return [];
      if (query.exclude?.noteId === material.noteId && query.exclude?.todoId === material.todoId) return [];
      if (query.projectId && (material.projectId ? material.projectId !== query.projectId :
          filedProjects.size && !filedProjects.has(query.projectId))) return [];
      const sameProject = !!query.projectId && material.projectId === query.projectId;
      const fallback = (material.text || material.files?.[0]?.name || material.title).slice(0,160);
      const used = !!query.target && !!material.usedBy?.some(ref=>materialTargetKey(ref)===materialTargetKey(query.target!));
      if (used) return [{score:Infinity,match:{...material,excerpt:fallback,reason:'已用于这个任务'}}];

      let best: {score:number;excerpt:string;reason:string} | undefined;
      for (const passage of evidence) {
        const hits = [...passage.terms.keys()].filter(term => wanted.has(term));
        const topical = hits.filter(term=>!supportingTerms.has(term));
        if (!topical.length) continue;
        // One short word in a request with several subjects is insufficient, even when
        // it appears in a filename, the declared purpose, or an already filed receipt.
        if (topical.length === 1 && subjects.length > 1 && topical[0].length < 3) continue;
        const fieldWeight = passage.field === '预留用途' ? 4 : passage.field === '结果说明' ? 3 : 2;
        const score = topical.length*10 + Math.min(2,hits.length-topical.length)*2 + fieldWeight +
          Math.min(2,[...passage.terms.keys()].filter(term=>!wanted.has(term) && !supportingTerms.has(term) && context.has(term)).length)*0.5;
        if (best && best.score >= score) continue;
        const labels = topical.slice(0,2).map(term=>{
          const word = passage.terms.get(term)!;
          const index = passage.excerpt.toLowerCase().indexOf(word);
          const actual = index < 0 ? word : passage.excerpt.slice(index,index+word.length);
          return word === wanted.get(term) ? '「'+actual+'」' : '「'+actual+'」（对应「'+wanted.get(term)+'」）';
        });
        best = {score,excerpt:passage.excerpt,reason:passage.field+'提到'+labels.join('、')};
      }
      if (best) return [{score:best.score + Number(sameProject)*0.1,match:{...material,excerpt:best.excerpt,reason:best.reason}}];

      // An explicitly filed receipt is a useful answer to "gather this project's materials".
      // A notebook title, a task's project context, or a partial project name cannot admit it.
      const name = material.projectId && projectNames.get(material.projectId);
      const namedProject = !query.projectId && gathering && name && query.text.toLowerCase().includes(name.toLowerCase())
        && !terms(query.text.toLowerCase().replace(name.toLowerCase(),'')).size;
      if ((asksForMaterials && sameProject && !wanted.size) || namedProject) {
        return [{score:0,match:{...material,excerpt:fallback,reason:namedProject ? '已归入「'+name+'」' : '已归入这个项目'}}];
      }
      return [];
    });
    return matches.sort((a,b) => b.score-a.score || b.match.at.localeCompare(a.match.at) ||
      a.match.noteId.localeCompare(b.match.noteId) || a.match.todoId.localeCompare(b.match.todoId))
      .slice(0,limit).map(item=>item.match);
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
