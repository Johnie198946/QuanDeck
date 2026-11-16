import { DISCUSSION_VISUAL_INSTRUCTIONS, readDiscussionVisualBlocks, type DiscussionVisualBlock } from "./discussionVisual";
import { readRuntimeSubmission } from './runtimeSubmission';

/** Public reply protocol. `confirmed` is a legacy field of proposals, never user consent. */
export const DISCUSSION_RESPONSE_INSTRUCTIONS = `本轮只讨论方案，不启动业务任务。用中文回答，先说结论，避免重复任务背景、权限说明和技术协议。summary 用 1–2 句话；confirmed 只放本轮建议用户确认的要点，通常 1–3 条；open 只问会影响下一步的 1–2 个问题。不要把建议或猜测写成用户已经确认的事实。用户明确提供的信息直接吸收，不要重复询问。无需填满条数，复杂问题可按必要程度展开。用户补充后，只回复变更要点和仍缺的信息。
返回一个 <quandeck-conclusion>{"summary":"本轮重点","confirmed":["待确认的建议"],"open":["需要用户补充的问题"]}</quandeck-conclusion>。所有文字字段可以使用 Markdown（标题、列表、表格、加粗、链接），不要在标签外重复同一内容。
需要时可在对象内添加 cards:[{title,body}]、charts:[{title,type:"bar"或"line",labels:["类别"],series:[{label:"系列",values:[数值]}]}、attachments:[{name,path:项目内文件路径}]。附件支持图片、视频、PDF、Excel(.xlsx)、Word(.docx)。只引用真实存在的文件和可核对的数据，不为展示效果虚构数值、文件或链接。不要输出 HTML 或可执行代码来替代卡片。` + "\n" + DISCUSSION_VISUAL_INSTRUCTIONS;

export interface DiscussionCard { title: string; body: string }
export interface DiscussionChart { title: string; type: 'bar' | 'line'; labels: string[]; series: { label: string; values: number[] }[] }
export interface DiscussionAttachment { name: string; path?: string; url?: string; kind?: string }
export interface DiscussionResponse { visualBlocks?: DiscussionVisualBlock[]; summary: string; proposals: string[]; questions: string[]; cards: DiscussionCard[]; charts: DiscussionChart[]; attachments: DiscussionAttachment[] }
export interface PresentedReply { content: string; conclusion?: DiscussionResponse; submission?: { title: string; kind: string }; malformed: boolean; raw: string }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

function normalize(value: unknown): DiscussionResponse | undefined {
  if (!record(value) || typeof value.summary !== 'string' || !strings(value.confirmed) || !strings(value.open)) return;
  const cards = Array.isArray(value.cards) ? value.cards.filter((v): v is DiscussionCard => record(v) && typeof v.title === 'string' && typeof v.body === 'string') : [];
  const charts = Array.isArray(value.charts) ? value.charts.filter((v): v is DiscussionChart => record(v) && typeof v.title === 'string' && ['bar', 'line'].includes(String(v.type)) && strings(v.labels) && v.labels.length > 0 && v.labels.length <= 100 && Array.isArray(v.series) && v.series.length > 0 && v.series.length <= 8 && v.series.every(s => record(s) && typeof s.label === 'string' && Array.isArray(s.values) && s.values.length === (v.labels as string[]).length && s.values.every(n => typeof n === 'number' && Number.isFinite(n)))) : [];
  const attachments = Array.isArray(value.attachments) ? value.attachments.filter((v): v is DiscussionAttachment => record(v) && typeof v.name === 'string' && (typeof v.path === 'string' || typeof v.url === 'string')) : [];
  const visualBlocks = readDiscussionVisualBlocks(value.visualBlocks);
  return { ...(visualBlocks.length ? {visualBlocks} : {}), summary: value.summary, proposals: value.confirmed, questions: value.open, cards, charts, attachments };
}

/** No heuristic conversion of prose into facts. Broken machine output stays in raw details. */
export function parseDiscussionResponse(raw: string): PresentedReply {
  const submitted = /<quandeck-submission>\s*([\s\S]*?)\s*<\/quandeck-submission>/i.exec(raw);
  if (submitted) {
    const read = readRuntimeSubmission(submitted[0]);
    if (read && 'envelope' in read) {
      const { kind, payload } = read.envelope;
      const title = typeof payload.title === 'string' ? payload.title : ({ result: '候选成果', checkpoint: 'Agent 进展', blocker: '需要处理', plan_proposal: '任务建议' })[kind];
      let content = '';
      if (kind === 'result' && typeof payload.body === 'string') content = payload.body;
      if (kind === 'blocker' && typeof payload.reason === 'string') content = payload.reason;
      if (kind === 'checkpoint') content = [strings(payload.completed) && payload.completed.length ? `已推进\n${payload.completed.map(v => `- ${v}`).join('\n')}` : '', strings(payload.remaining) && payload.remaining.length ? `待继续\n${payload.remaining.map(v => `- ${v}`).join('\n')}` : '', typeof payload.note === 'string' ? payload.note : ''].filter(Boolean).join('\n\n');
      if (kind === 'plan_proposal' && Array.isArray(payload.tasks)) content = payload.tasks.filter(record).map(v => typeof v.title === 'string' ? `- **${v.title}**${typeof v.goal === 'string' ? `：${v.goal}` : ''}` : '').filter(Boolean).join('\n');
      if (content) return { raw, content, submission: { title, kind }, malformed: false };
    }
    return { raw, content: '', malformed: true };
  }
  if (/<\/?quandeck-submission>/i.test(raw)) return { raw, content: '', malformed: true };
  const tags = /<quandeck-conclusion>\s*([\s\S]*?)\s*<\/quandeck-conclusion>/i;
  const match = tags.exec(raw);
  if (match) {
    try {
      const conclusion = normalize(JSON.parse(match[1]));
      if (conclusion) return { raw, conclusion, content: raw.replace(match[0], '').trim().replace(/^[“”"']{2}$/, ''), malformed: false };
    } catch { /* Render original data only on request. */ }
    return { raw, content: raw.replace(match[0], '').trim(), malformed: true };
  }
  if (/<\/?quandeck-conclusion>/i.test(raw)) return { raw, content: raw.split(/<\/?quandeck-conclusion>/i)[0].trim(), malformed: true };
  const candidate = raw.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```$/, '');
  if (candidate.startsWith('{')) {
    try {
      const conclusion = normalize(JSON.parse(candidate));
      if (conclusion) return { raw, conclusion, content: '', malformed: false };
    } catch { /* Plain prose, code and JSON unrelated to the protocol remain readable. */ }
  }
  return { raw, content: raw, malformed: false };
}

export interface ConfirmationDraft { selected: number[]; proposals: string[]; answers: string[]; extra: string; sent?: boolean }
export function newConfirmationDraft(value: DiscussionResponse): ConfirmationDraft {
  return { selected: [], proposals: [...value.proposals], answers: value.questions.map(() => ''), extra: '' };
}
export function confirmationMessage(value: DiscussionResponse, draft: ConfirmationDraft): string {
  const proposals = [...new Set(draft.selected)].filter(index => Number.isInteger(index) && index >= 0 && index < value.proposals.length).map(index => draft.proposals[index]?.trim()).filter(Boolean);
  const answers = value.questions.flatMap((question, index) => draft.answers[index]?.trim() ? [`${question}\n${draft.answers[index].trim()}`] : []);
  return [proposals.length ? `我确认以下信息：\n${proposals.map(text => `- ${text}`).join('\n')}` : '', answers.length ? `我的补充回答：\n${answers.join('\n\n')}` : '', draft.extra.trim() ? `我主动补充的信息：\n${draft.extra.trim()}` : ''].filter(Boolean).join('\n\n');
}

/** Deliberately separate deciding the approach from doing every piece in one run. */
export const PLAN_BREAKDOWN_INSTRUCTIONS = '在结论对象提供 outline:[{id, title, kind:"body", lines:[{id,text,state:"tentative"}]}] 保存可读的方向正文和交付结构；不要只返回任务列表。提供 deliverables:[{id:"route-map",title:"路线地图",taskKey:"routes",description:"可核验的路线和地图"}] 声明最终交付槽，taskKey 引用 tasks.key，可用 parentId 表达交付结构；同任务多交付必须分别列明。项目方向需要多个真正业务主任务，各任务可递归拆成多层子任务；不要创建一个包揽所有工作的假主任务。规划仅决定方向和执行逻辑。方向清楚时在结论对象添加 tasks 数组：[{"key":"routes","title":"查询路线","expected":"逐段可核验的地图路线","owner":"agent","phase":"执行","deps":[]},{"key":"airport","parentKey":"routes","title":"核对机场接驳","expected":"路线、时间、费用和来源","owner":"agent","phase":"执行","deps":[]}]。此例仅说明结构，实际标题和交付标准必须来自当前目标。复杂项目拆成多个可独立验收的任务，每个任务再按需要拆子任务；parentKey 和 deps 只引用本数组 key，无循环。父任务负责整合子成果；最终汇总任务依赖所有需要的子成果，不提前输出总成果。不要将用户偏好、已确认信息、礼貌提醒逐条变成任务。已确认的方向无需再次征求同意；只提出新差异或真正阻塞的未知条件。未获自动执行授权时说明当前为方案讨论；已明确授权自动执行时，返回可执行结构交给系统继续，不得再次要求确认或点击执行。后续回复可只返回变化；省略 outline 或 deliverables 表示沿用前轮，明确空数组才表示清除。';
