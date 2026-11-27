import { hashText } from "./contentHash";
import { segmentKnowledgeWords } from "./knowledgeWords";
import type { Snapshot } from "./types";

export interface SharedDecisionOption {
  id: string;
  text: string;
  taskKey?: string;
  origin: "task" | "human" | "requirement";
  at: string;
}
export interface SharedDecision {
  id: string;
  title: string;
  scope: string;
  taskKeys: string[];
  revision: number;
  options: SharedDecisionOption[];
  selectedOptionId?: string;
  history: { revision: number; optionId: string; reason: string; actor: string; at: string }[];
  closed?: boolean;
}
export interface SharedDecisionSuggestion {
  id: string;
  title: string;
  scope: string;
  taskKeys: string[];
  reason: string;
}
export interface SharedDecisionPin {
  id: string;
  revision: number;
  optionId: string;
}
export interface SharedDecisionState {
  items: SharedDecision[];
  dismissed: string[];
}
const error = (code: string, message: string): never => {
  throw Object.assign(new Error(message), { code });
};
const normalized = (s: string) => s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
const newId = (prefix: string) => prefix + "-" + globalThis.crypto.randomUUID();

export function sharedDecisionTasks(s: Snapshot) {
  return Object.values(s.collaboration?.tasks ?? {})
    .filter(
      (t) =>
        !t.archived &&
        t.status !== "cancelled" &&
        Object.prototype.hasOwnProperty.call(s.tasks, t.taskId) &&
        !t.key.startsWith("planning:"),
    )
    .map((t) => ({ key: t.key, title: t.title }));
}
export function listSharedDecisions(s: Snapshot, taskKey?: string): SharedDecision[] {
  return (s.collaboration?.sharedDecisions?.items ?? []).filter(
    (d) => !d.closed && (!taskKey || d.taskKeys.includes(taskKey)),
  );
}
/** Explicit dependencies and parent tasks define the downstream consumers of a choice. */
function decisionTaskScope(s: Snapshot, key: string) {
  const scope = new Set<string>();
  const queue = [key];
  while (queue.length) {
    const next = queue.pop()!;
    if (scope.has(next)) continue;
    scope.add(next);
    const t = s.collaboration?.tasks[next];
    if (!t) continue;
    queue.push(...t.dependencies);
    if (t.workItemId) {
      const parent = s.orchestrations?.[t.taskId]?.items[t.workItemId]?.parentTaskId;
      queue.push(
        !parent || parent === t.taskId
          ? t.taskId
          : parent.startsWith(t.taskId + "::")
            ? parent
            : t.taskId + "::" + parent,
      );
    }
  }
  return scope;
}
export function applicableSharedDecisions(s: Snapshot, key: string) {
  if (!s.collaboration?.sharedDecisions?.items.length) return [];
  const scope = decisionTaskScope(s, key);
  return listSharedDecisions(s).filter((d) => d.taskKeys.some((k) => scope.has(k)));
}
export function sharedDecisionConsumers(s: Snapshot, changed: string[]) {
  const changedKeys = new Set(changed);
  return Object.keys(s.collaboration!.tasks).filter((key) =>
    [...decisionTaskScope(s, key)].some((k) => changedKeys.has(k)),
  );
}
const ignored = new Set(
  "规划 计划 旅游 旅行 行程 安排 一起 酒店 旅馆 住宿 旅店 民宿 预订 预定 入住 选择 附近 旁边 出行 第一天 第二天 一晚 路线 查找 寻找 比较 推荐 需要 任务 调查 检查 全家 地点 整理 预算 价格 适合 到达 前往 抵达 第二 第一 帮忙 the and our for hotel hotels plan book near station lodging trip night stay from with booking accommodation".split(
    " ",
  ),
);
const categories = [
  {
    key: "release",
    title: "发布版本",
    pattern: /(?:发布|版本|升级|release|version|更新|package\.json)/i,
  },
  {
    key: "lodging",
    title: "住宿安排",
    pattern: /住宿|酒店|旅馆|民宿|住宿地|\b(?:hotels?|lodging|accommodations?|stay)\b/i,
  },
  {
    key: "document",
    title: "文档内容",
    pattern: /文档|手册|章节|草案|白皮书|需求书|规范|报告|\.md\b|\.docx?\b|\bdocument\b/i,
  },
] as const;
function signals(text: string) {
  const result: { key: string; title: string; scope: string; reason: string }[] = [];
  for (const category of categories) {
    if (!category.pattern.test(text)) continue;
    const add = (value: string, title: string, scope: string, reason: string) =>
      result.push({ key: category.key + ":" + normalized(value), title, scope, reason });
    if (category.key === "release") {
      if (/\bv?\d+\.\d+\.\d+\b/i.test(text) || /发布版本|版本号|release version/i.test(text))
        add(
          "version",
          category.title,
          "本项目的发布目标",
          "两个任务都在指定发布版本，请核对是否为同一产品和发布通道。",
        );
    } else if (category.key === "document") {
      const documents = [
        ...text.matchAll(/《([^》\n]{1,100})》|([\w.\/-]+\.(?:md|docx?))\b/gi),
      ].map((m) => m[1] ?? m[2]);
      const sections = [
        ...text.matchAll(
          /第[0-9一二三四五六七八九十百]+[章节]|[部署预算接口验收范围交付]{2,4}(?:章节|部分|说明)/g,
        ),
      ].map((m) => m[0]);
      for (const name of new Set([...documents, ...sections]))
        add(
          name,
          category.title,
          name,
          "两项工作提到了相同文档或章节，请核对是否要确定同一处内容。",
        );
    } else {
      const words = segmentKnowledgeWords(text).filter(
        (word) =>
          word.length >= 2 &&
          !ignored.has(word) &&
          !/\d|^[一二三四五六七八九十第月日号晚]+$/u.test(word),
      );
      for (const place of new Set(words))
        add(
          place,
          category.title,
          place,
          "两项住宿工作都提到了“" + place + "”，请核对旅客与入住日期。",
        );
    }
  }
  return result.sort((a, b) => a.key.localeCompare(b.key));
}
function nights(text: string) {
  return new Set(
    (
      text.match(
        /(?:\d{4}[-/年])?\d{1,2}[-/月]\d{1,2}(?:日|号)?|第[0-9一二三四五六七八九十]+晚/g,
      ) ?? []
    ).map((s) => s.replace(/[年/月]/g, "-").replace(/[日号]/g, "")),
  );
}

// Suppress only unambiguous pairs of single nights. Partial dates, ranges and
// mixed relative/calendar expressions still merit checking with the user.
function clearlyDifferentNights(left: string, right: string) {
  if (left.startsWith("第") || right.startsWith("第")) {
    const ordinal = (v: string) => /^第(\d+)晚$/.exec(v)?.[1];
    const a = ordinal(left),
      b = ordinal(right);
    return !!a && !!b && Number(a) !== Number(b);
  }
  const a = left.split("-").map(Number),
    b = right.split("-").map(Number);
  if (a.length === 3 && b.length === 3 && a[0] !== b[0]) return true;
  return a.at(-2) !== b.at(-2) || a.at(-1) !== b.at(-1);
}

/** Hints have no authority. Different nights and different tasks remain independently executable. */
export function suggestSharedDecisions(s: Snapshot, taskKey?: string): SharedDecisionSuggestion[] {
  const specs = new Map(s.collaboration?.specs.map((spec) => [spec.key, spec]));
  const ignore = new Set(s.collaboration?.sharedDecisions?.dismissed);
  const existing = listSharedDecisions(s);
  const index = new Map<string, { key: string; dates: Set<string> }[]>();
  const suggestions: SharedDecisionSuggestion[] = [];
  const seen = new Set<string>();
  const tasks = sharedDecisionTasks(s).filter(
    (task) => s.collaboration?.tasks[task.key].status !== "done",
  );
  const focus = taskKey && tasks.find((task) => task.key === taskKey);
  if (taskKey && !focus) return [];
  if (focus) tasks.splice(0, tasks.length, focus, ...tasks.filter((task) => task !== focus));
  for (const task of tasks) {
    const content = task.title + " " + (specs.get(task.key)?.goal ?? "");
    const dates = nights(content);
    for (const signal of signals(content)) {
      const bucket = index.get(signal.key) ?? [];
      for (const peer of bucket) {
        if (taskKey && taskKey !== peer.key && taskKey !== task.key) continue;
        if (
          signal.key.startsWith("lodging:") &&
          dates.size === 1 &&
          peer.dates.size === 1 &&
          clearlyDifferentNights([...dates][0], [...peer.dates][0])
        )
          continue;
        const keys = [peer.key, task.key].sort();
        const pair = JSON.stringify([signal.title, keys]);
        if (seen.has(pair)) continue;
        seen.add(pair);
        if (
          existing.some(
            (d) =>
              keys.every((k) => d.taskKeys.includes(k)) &&
              (d.title === signal.title || normalized(d.scope) === normalized(signal.scope)),
          )
        )
          continue;
        const id =
          "overlap-" +
          hashText(
            JSON.stringify([
              s.project.id,
              signal.key,
              keys,
              [
                [task.key, [...dates].sort()],
                [peer.key, [...peer.dates].sort()],
              ].sort(([a], [b]) => String(a).localeCompare(String(b))),
            ]),
          ).slice(0, 32);
        if (!ignore.has(id))
          suggestions.push({
            id,
            title: signal.title,
            scope: signal.scope,
            reason: signal.reason,
            taskKeys: keys,
          });
      }
      if (!focus || task.key === focus.key) {
        if (!bucket.some((peer) => peer.key === task.key)) bucket.push({ key: task.key, dates });
        index.set(signal.key, bucket);
      }
    }
  }
  return suggestions;
}
function string(v: unknown, label: string, max: number) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    return error("SCHEMA_INVALID", "请检查" + label + "的内容和长度");
  return v.trim();
}
function keys(s: Snapshot, v: unknown, minimum: number, allowInactive = false): string[] {
  if (!Array.isArray(v) || v.length < minimum || v.length > 32 || new Set(v).size !== v.length)
    return error("SCHEMA_INVALID", "请选择有效且不重复的关联任务");
  const valid = new Set(
    allowInactive
      ? Object.keys(s.collaboration?.tasks ?? {})
      : sharedDecisionTasks(s).map((task) => task.key),
  );
  return v.map((k) => {
    if (typeof k !== "string" || !valid.has(k))
      return error("NOT_FOUND", "关联任务已变化，请刷新后重试");
    return k;
  });
}
function addOption(
  d: SharedDecision,
  text: string,
  at: string,
  origin: SharedDecisionOption["origin"],
  taskKey?: string,
) {
  const same = d.options.find(
    (option) =>
      normalized(option.text) === normalized(text) &&
      option.taskKey === taskKey &&
      option.origin === origin,
  );
  if (same) return same;
  if (d.options.length >= 100) return error("LIMIT_REACHED", "该决定的候选已达上限");
  const option = { id: newId("option"), text, at, origin, ...(taskKey ? { taskKey } : {}) };
  d.options.push(option);
  d.revision++;
  return option;
}

export function updateSharedDecision(s: Snapshot, p: Record<string, unknown>, actor: string) {
  const state = (s.collaboration!.sharedDecisions ??= { items: [], dismissed: [] });
  const at = new Date().toISOString();
  const touched: string[] = [];
  const suggestion =
    p.suggestionId !== undefined
      ? suggestSharedDecisions(s).find((row) => row.id === p.suggestionId)
      : undefined;
  if (p.suggestionId !== undefined && !suggestion)
    return error("SUGGESTION_CHANGED", "交叉提示已变化，请刷新后核对");
  if (p.action === "dismiss") {
    if (
      !suggestion ||
      !Array.isArray(p.taskKeys) ||
      JSON.stringify([...p.taskKeys].sort()) !== JSON.stringify(suggestion.taskKeys)
    )
      return error("SUGGESTION_CHANGED", "任务范围已变化");
    state.dismissed.push(suggestion.id);
    return { id: suggestion.id, touched };
  }
  if (p.action === "link" && p.decisionId === undefined) {
    const title = string(p.title, "共同决定标题", 160),
      scope = string(p.scope, "适用范围", 500);
    const taskKeys = keys(s, p.taskKeys, 2);
    if (suggestion && !suggestion.taskKeys.every((k) => taskKeys.includes(k)))
      return error("SCOPE_MISMATCH", "请保留提示中的关联任务");
    const exists = state.items.find(
      (d) =>
        !d.closed &&
        normalized(d.title) === normalized(title) &&
        normalized(d.scope) === normalized(scope),
    );
    if (exists) return error("DECISION_EXISTS", "此范围已有同名共同决定，请在原记录中关联任务");
    const d: SharedDecision = {
      id: newId("decision"),
      title,
      scope,
      taskKeys,
      revision: 1,
      options: [],
      history: [],
    };
    state.items.push(d);
    if (suggestion) {
      state.dismissed.push(suggestion.id);
      if (suggestion.title === "发布版本")
        for (const key of suggestion.taskKeys) {
          const task = s.collaboration!.tasks[key];
          const spec = s.collaboration!.specs.find(
            (v) => v.key === key && v.revision === task.specRevision,
          );
          const versions = new Set(
            (task.title + " " + (spec?.goal ?? "")).match(/\bv?\d+\.\d+\.\d+(?:-[\w.-]+)?\b/gi) ??
              [],
          );
          if (versions.size === 1) addOption(d, [...versions][0], at, "requirement", key);
        }
    }
    return { id: d.id, touched };
  }
  const d = state.items.find((item) => item.id === p.decisionId && !item.closed);
  if (!d) return error("NOT_FOUND", "共同决定不存在或已解除");
  if (p.expectedRevision !== d.revision)
    return error("VERSION_CONFLICT", "共同决定已更新，请重新核对");
  if (p.action === "link") {
    const added = keys(s, p.taskKeys, 1).filter((k) => !d.taskKeys.includes(k));
    if (d.taskKeys.length + added.length > 32)
      return error("LIMIT_REACHED", "每项决定最多关联 32 个任务");
    if (added.length) {
      d.taskKeys.push(...added);
      d.revision++;
      if (d.selectedOptionId) touched.push(...added);
    }
  } else if (p.action === "unlink") {
    const removed = keys(s, p.taskKeys, 1, true);
    if (removed.some((k) => !d.taskKeys.includes(k)))
      return error("SCOPE_MISMATCH", "只能解除已关联的任务");
    const before = d.taskKeys;
    d.taskKeys = d.taskKeys.filter((k) => !removed.includes(k));
    d.revision++;
    if (d.taskKeys.length < 2) {
      d.closed = true;
      d.taskKeys = before;
    }
    if (d.selectedOptionId) touched.push(...(d.closed ? before : removed));
  } else if (p.action === "propose") {
    if (
      p.taskKey !== undefined &&
      (typeof p.taskKey !== "string" || !d.taskKeys.includes(p.taskKey))
    )
      return error("SCOPE_MISMATCH", "候选来源不属于关联任务");
    addOption(d, string(p.text, "候选", 2000), at, "human", p.taskKey as string | undefined);
  } else if (p.action === "confirm") {
    const option = d.options.find((o) => o.id === p.optionId);
    if (!option) return error("NOT_FOUND", "候选不存在");
    const reason = string(p.reason, "确认理由", 1000);
    if (option.id !== d.selectedOptionId) {
      d.revision++;
      d.selectedOptionId = option.id;
      d.history.push({ revision: d.revision, optionId: option.id, reason, actor, at });
      touched.push(...d.taskKeys);
    }
  } else return error("SCHEMA_INVALID", "未知共同决定操作");
  return { id: d.id, touched };
}

/** Only changes to an effective choice alter execution provenance; research may continue while pending. */
export function sharedDecisionPins(s: Snapshot, key: string): SharedDecisionPin[] {
  return applicableSharedDecisions(s, key)
    .flatMap((d) =>
      d.selectedOptionId
        ? [{ id: d.id, revision: d.history.at(-1)!.revision, optionId: d.selectedOptionId }]
        : [],
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}
export function sharedDecisionPinsCurrent(s: Snapshot, key: string, pins?: SharedDecisionPin[]) {
  return JSON.stringify(pins ?? []) === JSON.stringify(sharedDecisionPins(s, key));
}
export function sharedDecisionPrompt(s: Snapshot, key: string) {
  const rows = applicableSharedDecisions(s, key);
  const hints = suggestSharedDecisions(s, key).slice(0, 3);
  const lines: string[] = [];
  for (const h of hints) {
    const peer = h.taskKeys.find((k) => k !== key)!;
    lines.push(
      "可能与任务「" +
        s.collaboration!.tasks[peer].title +
        "」交叉：" +
        h.reason +
        " 继续独立工作，涉及交叉点时作为备选提交。",
    );
  }
  for (const d of rows) {
    const selected = d.options.find((o) => o.id === d.selectedOptionId);
    lines.push(
      "共同决定「" +
        d.title +
        "」（" +
        d.scope +
        "）：" +
        (selected ? "用户已确认 " + selected.text : "待确认；可继续调研及其余工作。"),
    );
    if (d.taskKeys.includes(key))
      lines.push(
        '可在 checkpoint 或 result 的 payload 中提交候选：decisionOptions=[{"decisionId":"' +
          d.id +
          '","text":"具体建议及依据"}]。候选由用户确认。',
      );
  }
  return lines.join("\n");
}
/** The adapter supplies the task identity. Agent payloads can only name a linked decision and propose text. */
export function collectSharedDecisionOptions(
  s: Snapshot,
  key: string,
  raw: unknown,
  at: string,
  origin: "task" | "human",
) {
  if (raw === undefined) return;
  if (!Array.isArray(raw) || !raw.length || raw.length > 12)
    return error("SCHEMA_INVALID", "共同决定候选列表无效");
  for (const entry of raw) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).some((field) => field !== "text" && field !== "decisionId")
    )
      return error("SCHEMA_INVALID", "候选只能填写决定编号与建议");
    const d = listSharedDecisions(s, key).find((row) => row.id === entry.decisionId);
    if (!d) return error("SCOPE_MISMATCH", "候选不属于本任务关联的共同决定");
    addOption(d, string(entry.text, "候选", 2000), at, origin, key);
  }
}
