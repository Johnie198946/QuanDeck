import { readDiscussionVisualBlocks } from './discussionVisual';
import type { Attempt, Executor, Orchestration, Session, WorkItem } from "./types";

// 演示编排：给读书笔记 App 加全文搜索。主 Agent：Claude Code；19:50 开始，截至 20:14 同步。
// 子任务记录 168k（互不重复）+ 主协调 18k = 186k。全部为示例数据，未连接任何 Agent。

export const SEARCH_TASK_ID = "task-a";
export const SEARCH_MAIN_SESSION = "ses-claude-search";

const link = (sessionId: string) => `claude-code://session/${sessionId}`;

export function createSearchMainSession(): Session {
  return {
    id: SEARCH_MAIN_SESSION,
    agentId: "claude",
    title: "给读书笔记App加全文搜索",
    origin: "dispatch",
    taskId: SEARCH_TASK_ID,
    dispatchId: "dsp-7f31",
    dispatchPhase: "acknowledged",
    status: "running",
    startedAt: "19:50",
    lastActivity: "20:14",
    // 主任务没有可核验的总步骤：不显示步骤进度
    step: null,
    // 含子代理的会话总量；主任务统计按唯一执行记录聚合，不再叠加子代理
    tokens: 186_000,
    rounds: [
      {
        id: "r-a1",
        at: "19:54",
        reply: "搜索范围已确认：标题、正文和书摘进入索引。已拆成 8 个子任务，交给 4 个子 Agent 并行处理。",
      },
      {
        id: "r-a2",
        at: "20:12",
        reply: "索引和搜索界面正在并行推进。拼音匹配等你确认，之后进入联调。",
      },
    ],
    subAgents: [],
    counted: true,
  };
}

export function createSearchOrchestration(): Orchestration {
  const executors: Record<string, Executor> = {
    "ex-main": { id: "ex-main", label: "主 Agent", agentId: "claude", parentExecutorId: null },
    "ex-explore": { id: "ex-explore", label: "代码探索子 Agent", agentId: "claude", parentExecutorId: "ex-main" },
    "ex-research": { id: "ex-research", label: "方案调研子 Agent", agentId: "claude", parentExecutorId: "ex-main" },
    "ex-dev-a": { id: "ex-dev-a", label: "开发子 Agent A", agentId: "claude", parentExecutorId: "ex-main" },
    "ex-dev-b": { id: "ex-dev-b", label: "开发子 Agent B", agentId: "claude", parentExecutorId: "ex-main" },
    // 开发子 Agent A 再派生的下级执行者
    "ex-data": { id: "ex-data", label: "测试数据子 Agent", agentId: "claude", parentExecutorId: "ex-dev-a" },
  };

  const A = (a: Omit<Attempt, "sourceLink" | "parentSessionId"> & { parentSessionId?: string | null }): Attempt => ({
    parentSessionId: SEARCH_MAIN_SESSION,
    ...a,
    sourceLink: link(a.sessionId),
  });

  const attempts: Record<string, Attempt> = {};
  const add = (a: Attempt) => (attempts[a.id] = a);
  add(
    A({
      id: "at-scope-1",
      workItemId: "w-scope",
      executorId: "ex-main",
      // 主 Agent 直接执行：来源就是主会话
      sessionId: SEARCH_MAIN_SESSION,
      parentSessionId: null,
      kind: "initial",
      status: "done",
      startedAt: "19:50",
      endedAt: "19:54",
      tokens: 12_000,
      rounds: [{ id: "r-w1", at: "19:54", reply: "范围确定：标题、正文和书摘进入索引，标签暂不纳入。" }],
    }),
  );
  add(
    A({
      id: "at-read-1",
      workItemId: "w-read",
      executorId: "ex-explore",
      sessionId: "ses-claude-sub-explore",
      kind: "initial",
      status: "interrupted",
      startedAt: "19:52",
      endedAt: "19:55",
      tokens: 9_000,
      note: "源会话中断（网络），由主 Agent 恢复",
      rounds: [],
    }),
  );
  add(
    A({
      id: "at-read-2",
      workItemId: "w-read",
      executorId: "ex-explore",
      sessionId: "ses-claude-sub-explore",
      kind: "resume",
      status: "done",
      startedAt: "19:55",
      endedAt: "19:58",
      tokens: 15_000,
      rounds: [
        { id: "r-w2", at: "19:58", reply: "现有存储是 SQLite，正文在 notes.body。可以直接建 FTS5 虚表，并用触发器同步。" },
      ],
    }),
  );
  add(
    A({
      id: "at-seg-1",
      workItemId: "w-segment",
      executorId: "ex-research",
      sessionId: "ses-claude-sub-research",
      kind: "initial",
      status: "done",
      startedAt: "19:54",
      endedAt: "20:02",
      tokens: 40_000,
      rounds: [
        { id: "r-w3", at: "20:02", reply: "对比了 3 种方案。推荐 jieba 分词接 FTS5 自定义 tokenizer，2 万条笔记建索引约 6 秒。" },
      ],
    }),
  );
  add(
    A({
      id: "at-index-1",
      workItemId: "w-index",
      executorId: "ex-dev-a",
      sessionId: "ses-claude-sub-dev-a",
      kind: "initial",
      status: "running",
      startedAt: "20:03",
      // 自身 40k；下级子任务另记 12k，分支合计 52k
      tokens: 40_000,
      step: { completed: 2, total: 4, label: "接入分词 tokenizer" },
      rounds: [{ id: "r-w4", at: "20:11", reply: "FTS5 虚表和同步触发器已建好，正在接入分词 tokenizer。" }],
    }),
  );
  add(
    A({
      id: "at-seed-1",
      workItemId: "w-seed",
      executorId: "ex-data",
      sessionId: "ses-claude-sub-data",
      parentSessionId: "ses-claude-sub-dev-a",
      kind: "initial",
      status: "done",
      startedAt: "20:05",
      endedAt: "20:08",
      tokens: 8_000,
      rounds: [{ id: "r-w4a", at: "20:08", reply: "已生成 20,000 条测试笔记，其中 3,000 条为中英混排。" }],
    }),
  );
  add(
    A({
      id: "at-edge-1",
      workItemId: "w-edge",
      executorId: "ex-data",
      sessionId: "ses-claude-sub-data",
      parentSessionId: "ses-claude-sub-dev-a",
      kind: "initial",
      status: "running",
      startedAt: "20:09",
      tokens: 4_000,
      step: null,
      rounds: [],
    }),
  );
  add(
    A({
      id: "at-ui-1",
      workItemId: "w-ui",
      executorId: "ex-dev-b",
      sessionId: "ses-claude-sub-dev-b",
      kind: "initial",
      status: "running",
      startedAt: "20:04",
      tokens: 31_000,
      step: { completed: 1, total: 3, label: "结果列表与高亮" },
      rounds: [{ id: "r-w5", at: "20:10", reply: "搜索框已放在笔记列表顶部，正在做结果高亮。" }],
    }),
  );
  add(
    A({
      id: "at-pinyin-1",
      workItemId: "w-pinyin",
      executorId: "ex-main",
      sessionId: SEARCH_MAIN_SESSION,
      parentSessionId: null,
      kind: "initial",
      status: "waiting_reply",
      startedAt: "20:04",
      tokens: 9_000,
      rounds: [
        {
          id: "r-w6",
          at: "20:06",
          reply: "分词方案不含拼音。是否支持拼音首字母搜索？例如输入“qwss”能找到“全文搜索”。",
        },
      ],
    }),
  );

  const W = (w: Omit<WorkItem, "rootTaskId">): WorkItem => ({ rootTaskId: SEARCH_TASK_ID, ...w });
  const items: Record<string, WorkItem> = {};
  for (const w of [
    W({ id: "w-scope", parentTaskId: SEARCH_TASK_ID, title: "确认搜索范围", phase: "理解", dependsOnTaskIds: [], executorId: "ex-main", status: "done", attemptIds: ["at-scope-1"] }),
    W({ id: "w-read", parentTaskId: SEARCH_TASK_ID, title: "阅读现有索引代码", phase: "理解", dependsOnTaskIds: [], executorId: "ex-explore", status: "done", attemptIds: ["at-read-1", "at-read-2"] }),
    W({ id: "w-segment", parentTaskId: SEARCH_TASK_ID, title: "比较中文分词方案", phase: "理解", dependsOnTaskIds: ["w-scope"], executorId: "ex-research", status: "done", attemptIds: ["at-seg-1"] }),
    W({ id: "w-index", parentTaskId: SEARCH_TASK_ID, title: "实现全文索引", phase: "实现", dependsOnTaskIds: ["w-read", "w-segment"], executorId: "ex-dev-a", status: "running", attemptIds: ["at-index-1"] }),
    W({ id: "w-seed", parentTaskId: "w-index", title: "生成 2 万条测试笔记", phase: "实现", dependsOnTaskIds: [], executorId: "ex-data", status: "done", attemptIds: ["at-seed-1"] }),
    W({ id: "w-edge", parentTaskId: "w-index", title: "验证分词边界用例", phase: "实现", dependsOnTaskIds: ["w-seed"], executorId: "ex-data", status: "running", attemptIds: ["at-edge-1"] }),
    W({ id: "w-ui", parentTaskId: SEARCH_TASK_ID, title: "制作搜索界面", phase: "实现", dependsOnTaskIds: ["w-scope"], executorId: "ex-dev-b", status: "running", attemptIds: ["at-ui-1"] }),
    W({
      id: "w-pinyin",
      parentTaskId: SEARCH_TASK_ID,
      title: "确认拼音匹配",
      phase: "实现",
      dependsOnTaskIds: ["w-segment"],
      executorId: "ex-main",
      status: "waiting_reply",
      statusReason: "等你回复：是否支持拼音首字母搜索",
      attemptIds: ["at-pinyin-1"],
      waiting: {
        kind: "reply",
        question: "是否支持拼音首字母搜索？例如输入“qwss”能找到“全文搜索”。",
        impact: "影响联调与交付；索引和搜索界面可继续。",
        since: "20:06",
      },
    }),
    W({ id: "w-integrate", parentTaskId: SEARCH_TASK_ID, title: "联调与测试", phase: "交付", dependsOnTaskIds: ["w-index", "w-ui", "w-pinyin"], executorId: "ex-main", status: "blocked", attemptIds: [] }),
    W({ id: "w-handoff", parentTaskId: SEARCH_TASK_ID, title: "整理交付说明", phase: "交付", dependsOnTaskIds: ["w-integrate"], executorId: "ex-main", status: "blocked", attemptIds: [] }),
  ])
    items[w.id] = w;

  const methodLines: Record<string, string[]> = {
    "w-scope": ["search-goal", "search-scope"], "w-read": ["search-research"], "w-segment": ["search-research"],
    "w-index": ["search-implement"], "w-ui": ["search-implement"], "w-seed": ["search-verify"], "w-edge": ["search-verify"],
    "w-pinyin": ["search-pinyin"], "w-integrate": ["search-verify"], "w-handoff": ["search-delivery"],
  };
  for (const item of Object.values(items)) item.source = { planId: `plan-${SEARCH_TASK_ID}`, version: 1, lineIds: methodLines[item.id] ?? [] };


  return {
    taskId: SEARCH_TASK_ID,
    label: "全文搜索",
    mainAgentId: "claude",
    mainSessionId: SEARCH_MAIN_SESSION,
    mainExecutorId: "ex-main",
    startedAt: "19:50",
    syncedAt: "20:14",
    coordinationTokens: 18_000,
    phases: ["理解", "实现", "交付"],
    executors,
    items,
    itemOrder: ["w-scope", "w-read", "w-segment", "w-index", "w-seed", "w-edge", "w-ui", "w-pinyin", "w-integrate", "w-handoff"],
    attempts,
    capabilities: { subAgents: true, steps: true, tokens: true, permissionEvents: true },
  };
}

/** Adopted discussion method attached only to the explicit sample snapshot. */
export function createSearchMethodPlan(): import("./types").IdeaPlan {
  const draft: import("./types").PlanDoc = { sections: [
    { id: "s-goal", title: "目标与范围", kind: "key", lines: [
      { id: "search-goal", text: "让读书笔记 App 能检索标题、正文与书摘。", state: "fixed" },
      { id: "search-scope", text: "第一版先覆盖中文与中英混排，标签检索留到后续。", state: "fixed" },
    ] },
    { id: "s-method", title: "执行方法", kind: "body", lines: [
      { id: "search-research", text: "先阅读现有存储与索引代码，再比较中文分词方案。", state: "fixed" },
      { id: "search-implement", text: "索引和搜索界面并行开发，以统一查询接口联调。", state: "fixed" },
      { id: "search-verify", text: "用 2 万条测试笔记验证检索、混排与边界用例，汇总测试结果。", state: "fixed" },
    ] },
    { id: "s-delivery", title: "验收与交付", kind: "key", lines: [
      { id: "search-delivery", text: "交付可用的全文搜索、测试记录与接入说明。", state: "fixed" },
    ] },
    { id: "s-open", title: "待决定", kind: "key", lines: [{ id: "search-pinyin", text: "是否支持拼音首字母匹配。", state: "open" }] },
  ] };
  return {
    id: `plan-${SEARCH_TASK_ID}`, taskId: SEARCH_TASK_ID, itemId: null, title: "全文搜索实现方法",
    script: "generic", step: 0, round: 1, draft, draftVersion: 1,
    adopted: { version: 1, doc: structuredClone(draft), at: "19:50", draftVersion: 1, conclusionIds: ["search-method-discussion"] }, turns: [], drafts: [],
    discussion: { agentId: "claude", conclusions: [{ id: "search-method-discussion", agentId: "claude", scopeId: "root", recordedAt: "19:50",
      visualBlocks: readDiscussionVisualBlocks([{id: 'search-example-flow', kind: 'flow', title: '示例 · 搜索功能怎样交付', flow: {
        version: 1, nodes: [{id:'scope',label:'确认搜索范围'}, {id:'index',label:'建立内容索引'}, {id:'screen',label:'制作搜索界面'}, {id:'review',label:'一起试用并验收'}],
        edges: [{from:'scope',to:'index'}, {from:'scope',to:'screen'}, {from:'index',to:'review'}, {from:'screen',to:'review'}],
      }}]),
      summary: "先确认范围与分词方案，再并行实现索引和界面，最后统一联调验收。", confirmed: ["标题、正文和书摘进入索引", "支持中文与中英混排", "开发后统一联调验收"], open: ["拼音首字母搜索待确认"], source: "sample", adopted: true, adoptedAt: "19:50", adoptedDraftVersion: 1 }] },
  };
}
