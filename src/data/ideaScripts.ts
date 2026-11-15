import type { PlanDoc } from "./types";
import { daysOf, findLine } from "./ideas";
import type { DraftTemplate, ScriptStep } from "./ideas";

// 演示 AI 的预设脚本（未接入真实模型）。只覆盖“旅行计划”场景；其他想法使用通用框架并如实说明。
// 全部为演示数据：不含实时价格、班次，也不代表实际订票或出游。

export const isTravelIdea = (text: string) => /旅行|旅游|出游|度假|游玩/.test(text);

const sec = (id: string, title: string, kind: "key" | "body" = "key") => ({ id, title, kind, lines: [] });

export function rootSkeleton(): PlanDoc {
  return {
    sections: [
      sec("s-goal", "目标"),
      sec("s-deliv", "交付物"),
      sec("s-fixed", "已确定"),
      sec("s-assume", "暂定假设"),
      sec("s-open", "待决定"),
      sec("s-daily", "每日安排", "body"),
      sec("s-transport", "交通衔接", "body"),
      sec("s-photo", "照片与路线示意", "body"),
      sec("s-note", "笔记结构", "body"),
    ],
  };
}

export const TRAVEL_STEPS: ScriptStep[] = [
  {
    ai: "我先把已有信息搭成草稿，不确定的都标了待定。最影响整体安排的是两件事：去几天、和谁一起。",
    options: [{ label: "5 天，和伴侣，每天一两个点" }, { label: "3 天，一个人随走随停" }],
    ops: [
      { op: "add", section: "s-goal", line: { id: "l-goal", text: "形成一份轻松旅行的图文计划笔记（只做计划，不订票）", state: "fixed" } },
      { op: "add", section: "s-deliv", line: { id: "l-deliv", text: "图文计划笔记", state: "tentative" } },
      { op: "add", section: "s-fixed", line: { id: "l-pace", text: "节奏轻松，不赶行程", state: "fixed" } },
      { op: "add", section: "s-assume", line: { id: "l-dest", text: "目的地：高铁 3 小时内的城市", state: "tentative" } },
      { op: "add", section: "s-open", line: { id: "l-q-days", text: "去几天？", state: "open" } },
      { op: "add", section: "s-open", line: { id: "l-q-people", text: "和谁一起？", state: "open" } },
      { op: "add", section: "s-open", line: { id: "l-q-transport", text: "怎么去？", state: "open" } },
      { op: "add", section: "s-open", line: { id: "l-q-photo", text: "照片和路线怎么呈现？", state: "open" } },
      { op: "add", section: "s-daily", line: { id: "l-daily-0", text: "每日安排待讨论", state: "open" } },
      { op: "add", section: "s-transport", line: { id: "l-tr-0", text: "交通方式待讨论", state: "open" } },
      { op: "add", section: "s-photo", line: { id: "l-photo-0", text: "照片呈现待讨论", state: "open" } },
      { op: "add", section: "s-note", line: { id: "l-note-0", text: "笔记结构待讨论", state: "open" } },
    ],
  },
  {
    ai: "已写入：5 天、两人、每天 1–2 个点。下一步交通差别最大，两种思路：",
    compare: {
      cols: ["高铁 + 市内公交", "自驾"],
      rows: [
        ["疲劳", "可在车上休息", "全程驾驶"],
        ["灵活", "受班次限制", "随时出发"],
        ["轻松节奏", "更合适", "长途易累"],
      ],
      note: "演示比较，不含实时价格与班次",
    },
    options: [{ label: "选高铁，不想开车累" }, { label: "自驾，想去郊外" }],
    ops: [
      { op: "add", section: "s-fixed", line: { id: "l-days", text: "5 天", state: "fixed" } },
      { op: "add", section: "s-fixed", line: { id: "l-people", text: "两人（和伴侣）", state: "fixed" } },
      { op: "set", line: "l-pace", text: "每天 1–2 个主要活动，下午留白" },
      { op: "remove", line: "l-q-days" },
      { op: "remove", line: "l-q-people" },
      { op: "set", line: "l-daily-0", text: "上午 1 个主活动，下午留白，晚饭就近", state: "tentative" },
    ],
  },
  {
    ai: "交通定为高铁 + 公交，每日原则也确定了。还有一个影响笔记形态的问题：照片和路线怎么呈现？建议参考素材和你自己的照片分开标注。",
    options: [{ label: "每天一张路线示意 + 3 张照片，先用参考图，回来换成自己的" }, { label: "只放自己的照片" }],
    ops: [
      { op: "add", section: "s-fixed", line: { id: "l-transport", text: "高铁往返 + 市内公交 / 步行，不自驾", state: "fixed" } },
      { op: "remove", line: "l-q-transport" },
      { op: "set", line: "l-pace", state: "fixed" },
      { op: "set", line: "l-daily-0", state: "fixed" },
      { op: "add", section: "s-daily", line: { id: "l-daily-1", text: "每天一页：主活动 / 留白 / 交通衔接", state: "tentative" } },
      { op: "set", line: "l-tr-0", text: "到达日只安排步行可达的活动；返程避开晚高峰", state: "tentative" },
    ],
  },
  {
    ai: "方案基本成形，只剩出发日期待定。已明确的部分可以先整理成任务，日期可以继续讨论，或作为一项任务由你确认。",
    options: [{ label: "整理为任务", action: "drafts" }],
    ops: [
      { op: "add", section: "s-fixed", line: { id: "l-photo", text: "参考素材与自己的照片分开标注，参考图注明来源", state: "fixed" } },
      { op: "remove", line: "l-q-photo" },
      { op: "set", line: "l-photo-0", text: "每天 1 张路线示意 + 3 张照片；出发前用参考图，回来替换为自己的", state: "fixed" },
      { op: "set", line: "l-note-0", text: "总览 → 每日（路线示意 + 照片）→ 交通 → 出行清单", state: "fixed" },
      { op: "set", line: "l-deliv", text: "图文计划笔记：总览、每日行程、交通、照片与路线示意", state: "fixed" },
      { op: "set", line: "l-daily-1", state: "fixed" },
      { op: "add", section: "s-open", line: { id: "l-q-date", text: "具体出发日期？", state: "open" } },
    ],
  },
];

/** 围绕正文段落的讨论：只改动该段落 */
export const TRAVEL_SECTION_REPLIES: Record<string, ScriptStep> = {
  "s-transport": {
    ai: "只看交通衔接：建议酒店选在地铁站步行 10 分钟内，片区之间单程不超过 40 分钟。已作为暂定条目加入此段。",
    ops: [{ op: "add", section: "s-transport", line: { id: "l-tr-hotel", text: "酒店在地铁站步行 10 分钟内；片区间单程 ≤ 40 分钟", state: "tentative" } }],
  },
  "s-daily": {
    ai: "只看每日安排：雨天可以给每天准备一个室内备选。已作为暂定条目加入此段。",
    ops: [{ op: "add", section: "s-daily", line: { id: "l-daily-rain", text: "每天准备 1 个室内备选（雨天用）", state: "tentative" } }],
  },
  "s-photo": {
    ai: "只看照片：路线示意可以用手绘风格，不需要精确地图。已作为暂定条目加入此段。",
    ops: [{ op: "add", section: "s-photo", line: { id: "l-photo-sketch", text: "路线示意用手绘风格，不追求精确", state: "tentative" } }],
  },
  "s-note": {
    ai: "只看笔记结构：可以在最后加一页“出行清单”。已作为暂定条目加入此段。",
    ops: [{ op: "add", section: "s-note", line: { id: "l-note-list", text: "最后一页：出行清单", state: "tentative" } }],
  },
};

export const TRAVEL_TEMPLATES: DraftTemplate[] = [
  { key: "dates", title: "确认日期与同行人", expected: () => "出发日期与同行人写入方案", deps: [], owner: "me", lineIds: ["l-q-date", "l-people"], requires: ["l-people"], phase: "准备" },
  { key: "transport", title: "比较交通", expected: () => "高铁时段与换乘对比（演示，不含实时价格与班次）", deps: [], owner: "agent", agentId: "claude", lineIds: ["l-transport", "l-tr-0", "l-days"], requires: ["l-transport"], phase: "准备" },
  { key: "daily", title: "整理每日行程", expected: (d) => `${daysOf(d) ?? "?"} 天每日安排`, deps: ["dates", "transport"], owner: "unassigned", lineIds: ["l-days", "l-pace", "l-daily-0", "l-daily-1"], requires: ["l-days", "l-daily-0"], phase: "整理" },
  { key: "photos", title: "选择照片素材", expected: (d) => `每天 3 张参考图（注明来源），共 ${(daysOf(d) ?? 0) * 3} 张`, deps: [], owner: "me", lineIds: ["l-photo", "l-photo-0", "l-days"], requires: ["l-photo"], phase: "整理" },
  { key: "note", title: "汇总旅行计划笔记", expected: () => "完整图文计划笔记", deps: ["daily", "photos"], owner: "agent", agentId: "claude", lineIds: ["l-note-0", "l-deliv"], requires: ["l-note-0"], phase: "成稿" },
  { key: "review", title: "审阅最终笔记", expected: () => "你确认笔记内容（不代表旅行已完成）", deps: ["note"], owner: "me", lineIds: ["l-goal"], requires: ["l-goal"], phase: "成稿" },
];

// ---------- 局部方案：整理每日行程 ----------

export const INHERITED_LINES = ["l-days", "l-people", "l-pace", "l-transport"];

export function dailySkeleton(): PlanDoc {
  return {
    sections: [sec("s-route", "路线顺序", "body"), sec("s-pick", "活动取舍", "body"), sec("s-link", "交通衔接", "body")],
  };
}

export const DAILY_STEPS: ScriptStep[] = [
  {
    ai: "已带入上级已确定的天数、同行人、节奏和交通。先定路线顺序：A 由近到远，最后一天离车站近；B 先去最远处，返程轻松。",
    options: [{ label: "B：先远后近" }, { label: "A：由近到远" }],
    ops: [
      { op: "add", section: "s-route", line: { id: "l-route", text: "路线顺序待定", state: "open" } },
      { op: "add", section: "s-pick", line: { id: "l-pick", text: "活动取舍待定", state: "open" } },
      { op: "add", section: "s-link", line: { id: "l-link", text: "片区衔接待定", state: "open" } },
    ],
  },
  {
    ai: "路线定为先远后近；活动按每天 1 主 1 备。另有一个建议与上级方案冲突，需要你决定：",
    conflict: { text: "第 4 天包车去郊外会更顺", parentLine: "高铁往返 + 市内公交 / 步行，不自驾" },
    options: [{ label: "片区之间按公交衔接" }],
    ops: [
      { op: "set", line: "l-route", text: "先去最远的片区，最后一天住车站附近", state: "fixed" },
      { op: "set", line: "l-pick", text: "每天 1 个主活动 + 1 个备选", state: "fixed" },
      { op: "add", section: "s-route", line: { id: "l-route-45", text: "第 4–5 天：郊外片区", state: "tentative" } },
    ],
  },
  {
    ai: "片区之间用地铁 / 公交衔接。可以整理成子任务了。",
    options: [{ label: "整理为子任务", action: "drafts" }],
    ops: [
      { op: "set", line: "l-link", text: "片区之间地铁 / 公交，单程 ≤ 40 分钟", state: "fixed" },
      { op: "set", line: "l-route-45", state: "fixed" },
    ],
  },
];

export const DAILY_TEMPLATES: DraftTemplate[] = [
  { key: "route", title: "确定路线顺序", expected: (d) => findLine(d, "l-route")?.line.text ?? "路线顺序", deps: [], owner: "me", lineIds: ["l-route", "l-days"], requires: ["l-route"], phase: "整理" },
  { key: "pick", title: "活动取舍", expected: () => "每天 1 主 1 备的活动清单", deps: ["route"], owner: "agent", agentId: "claude", lineIds: ["l-pick", "l-days", "l-pace"], requires: ["l-pick"], phase: "整理" },
  { key: "link", title: "交通衔接", expected: () => "片区之间的地铁 / 公交衔接", deps: ["route"], owner: "unassigned", lineIds: ["l-link", "l-transport"], requires: ["l-link"], phase: "整理" },
  { key: "day45", title: "整理第 4–5 天行程", expected: () => "郊外片区两天的安排", deps: ["route"], owner: "unassigned", lineIds: ["l-route-45", "l-days"], requires: ["l-route-45"], phase: "整理", minDays: 4 },
];

// ---------- 通用想法：没有预设脚本，如实说明 ----------

export function genericSteps(text: string): ScriptStep[] {
  return [
    {
      ai: "我把这个想法搭成了草稿，未知的都标了待定。演示版只为“旅行计划”预置了多轮讨论；你可以直接编辑方案，或把明确的部分整理为任务。",
      options: [{ label: "整理为任务", action: "drafts" }],
      ops: [
        { op: "add", section: "s-goal", line: { id: "l-goal", text, state: "fixed" } },
        { op: "add", section: "s-deliv", line: { id: "l-deliv", text: "交付物待定", state: "open" } },
        { op: "add", section: "s-open", line: { id: "l-q-scope", text: "范围和完成标准？", state: "open" } },
        { op: "add", section: "s-open", line: { id: "l-q-time", text: "时间安排？", state: "open" } },
      ],
    },
  ];
}

export function genericSkeleton(): PlanDoc {
  return { sections: [sec("s-goal", "目标"), sec("s-deliv", "交付物"), sec("s-fixed", "已确定"), sec("s-assume", "暂定假设"), sec("s-open", "待决定")] };
}

export const GENERIC_TEMPLATES = (text: string): DraftTemplate[] => [
  { key: "first", title: text.length > 18 ? `${text.slice(0, 18)}…` : text, expected: () => "按方案完成", deps: [], owner: "me", lineIds: ["l-goal"], requires: ["l-goal"], phase: "准备" },
];
