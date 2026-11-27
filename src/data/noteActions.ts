import {
  updateNote,
  type KnowledgeLibrary,
  type KnowledgeNote,
  type NoteSelection,
} from "./knowledgeNotes";
import { noteListItems } from "./noteListItems";

type Operation = "strike" | "unstrike" | "replace" | "append" | "complete_todo" | "reopen_todo";
interface ActionTarget {
  ref: string;
  noteId: string;
  noteTitle: string;
  revision: number;
  label: string;
  start: number;
  end: number;
  expected: string;
  ops: Operation[];
  todoId?: string;
  completedAt?: string;
  number?: string;
  strikeRanges?: { start: number; end: number }[];
}
export interface NoteActionPlan {
  status: "pending" | "applied" | "failed";
  message?: string;
  changes: (Omit<ActionTarget, "ops" | "ref"> & { operation: Operation; text?: string })[];
}
export interface NoteActionRequest {
  targets: ActionTarget[];
}
export function noteActionRequest(
  library: KnowledgeLibrary,
  noteId: string,
  selection: NoteSelection,
  question: string,
): NoteActionRequest | undefined {
  if (
    /(?:不要|不需要|别|无需|暂不|先不|如何|怎么|假如|假设|举例|解释|是否能|能不能介绍|只(?:想|需要)?(?:统计|查看|列出|看看))/u.test(
      question,
    )
  )
    return;
  if (
    /(?:哪些|多少|几条|几项|统计|盘点|清点|有没有|是否|没有|没被|没划|没画|未划|未画|已划|已画)/u.test(
      question,
    ) &&
    !/(?:请|帮我|将|把|我要|给)[^。？?]{0,80}(?:划掉|划去|改成|改为|取消删除线|追加|标记为|勾选|加上删除线)/u.test(
      question,
    )
  )
    return;
  if (
    /(?:统计|盘点|清点|列出|看看|指出|告诉我|多少|哪些|几条|几项)[^。！？]{0,60}(?:没|未|已|是否)[^。！？]{0,10}(?:划掉|划去|划线|删除线)/u.test(
      question,
    )
  )
    return;
  const ops: Operation[] = [];
  if (
    /(?:取消|去掉|撤销|移除|去除)(?:这[些条段])?.{0,6}(?:划线|删除线)|恢复.{0,5}未划线/u.test(
      question,
    )
  )
    ops.push("unstrike");
  else if (
    /(?:划掉|划去|划除|划销|加.{0,4}(?:划线|删除线)|画.{0,3}删除线|标记.{0,5}完成)/u.test(question)
  )
    ops.push("strike");
  if (
    /(?:修改|改写|改成|改为|更正|替换|更新).{0,80}(?:为|成|正文|原文|笔记|条|项)|(?:把|将).{1,80}(?:改成|改为|替换成|修改为)/u.test(
      question,
    )
  )
    ops.push("replace");
  if (
    /追加|添加到.{0,8}笔记|写(?:入|到).{0,8}笔记|笔记.{0,10}(?:补上|补充|加上)|新增.{0,6}条/u.test(
      question,
    )
  )
    ops.push("append");
  if (
    /(?:完成|勾选|勾上).{0,8}(?:待办|事项)|(?:待办|事项).{0,40}(?:标为|标记为|设为)完成/u.test(
      question,
    )
  )
    ops.push("complete_todo");
  if (
    /(?:恢复|重新打开|重开|取消完成).{0,8}待办|待办.{0,30}(?:未完成|重新打开|取消完成)/u.test(
      question,
    )
  )
    ops.push("reopen_todo");
  if (!ops.length) return;
  const named = [...question.matchAll(/《([^》]+)》/gu)].map((m) => m[1]);
  const notes = library.notes.filter(
    (n) =>
      !n.archivedAt &&
      !library.deletedNoteIds?.includes(n.id) &&
      (named.length ? named.includes(n.title) : n.id === noteId),
  );
  if (named.some((title) => notes.filter((n) => n.title === title).length !== 1))
    throw Error("目标笔记标题重复或已变化，请打开原笔记后再操作。");
  const targets: ActionTarget[] = [];
  function add(
    note: KnowledgeNote,
    start: number,
    end: number,
    label: string,
    allowed: Operation[],
    extra: Partial<ActionTarget> = {},
  ) {
    const permitted = allowed.filter((op) => ops.includes(op));
    if (permitted.length)
      targets.push({
        ref: "r" + (targets.length + 1),
        noteId: note.id,
        noteTitle: note.title,
        revision: note.revision,
        start,
        end,
        expected: note.body.slice(start, end),
        label,
        ops: permitted,
        ...extra,
      });
  }
  const numbers = new Set(
    [...question.matchAll(/第\s*(\d+(?:\s*[、，,和及]\s*\d+)*)\s*[条项号]/gu)].flatMap(
      (m) => m[1].match(/\d+/gu) ?? [],
    ),
  );
  for (const note of notes) {
    const items = noteListItems(note);
    const selected =
      note.id === noteId &&
      selection.quote &&
      note.body.slice(selection.offset, selection.offset + selection.quote.length) ===
        selection.quote;
    if (!numbers.size && selected)
      add(
        note,
        selection.offset,
        selection.offset + selection.quote.length,
        "选段 · " + selection.quote,
        ["replace"],
      );
    add(note, note.body.length, note.body.length, "在笔记末尾追加", ["append"]);
    for (const item of items) {
      if (
        selected &&
        /(?:这段|选段|选中|所选)/u.test(question) &&
        ops.length === 1 &&
        ops[0] === "replace"
      )
        continue;
      if (
        numbers.has(item.number ?? "") &&
        items.filter((other) => other.number === item.number).length > 1 &&
        !question.includes(item.text) &&
        !(selected && selection.offset >= item.start && selection.offset < item.end)
      )
        continue;
      if (numbers.size && (!item.number || !numbers.has(item.number))) continue;
      const prefix = item.raw.match(/^\s*(?:\d+[.)、．）]|[-*+•●]|\[[ xX]\])\s*/u)?.[0] ?? "";
      const allowed: Operation[] = ["replace"];
      if (item.status !== "struck") allowed.push("strike");
      if (item.strikeRanges.length) allowed.push("unstrike");
      add(
        note,
        item.start + prefix.length,
        item.end,
        (item.number ? item.number + ". " : "") + item.text,
        allowed,
        { number: item.number, strikeRanges: item.strikeRanges },
      );
    }
    for (const todo of note.todos ?? []) {
      const item = items.find((i) => i.lineIndex === todo.lineIndex);
      if (numbers.size && (!item?.number || !numbers.has(item.number))) continue;
      if (
        item?.number &&
        numbers.has(item.number) &&
        items.filter((other) => other.number === item.number).length > 1 &&
        !question.includes(todo.text) &&
        !(selected && selection.offset >= item.start && selection.offset < item.end)
      )
        continue;
      add(note, 0, 0, todo.text, [todo.completedAt ? "reopen_todo" : "complete_todo"], {
        todoId: todo.id,
        completedAt: todo.completedAt,
        number: item?.number,
      });
    }
  }
  if (!targets.length)
    throw Error("没有找到可执行的对应选段、条目或待办。请核对笔记、条目编号和当前状态。");
  return { targets };
}
export function actionEvidence(request: NoteActionRequest) {
  return request.targets.map((t) => ({
    ref: t.ref,
    note: t.noteTitle,
    label: t.label,
    ops: t.ops,
    number: t.number,
  }));
}
export function readNoteAction(
  answer: string,
  request: NoteActionRequest | undefined,
): NoteActionPlan | undefined {
  const raw = answer.trim().replace(/^`{3}(?:json)?\s*|\s*`{3}$/gu, "");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (raw.startsWith("{") && raw.includes('"quandeck_edit"'))
      throw Error("笔记操作格式不完整，请重试。");
    return;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Object.prototype.hasOwnProperty.call(parsed, "quandeck_edit")
  )
    return;
  if (!request) throw Error("这次提问没有指定笔记修改，客户端没有更改内容。");
  const edits: unknown = parsed.quandeck_edit;
  if (!Array.isArray(edits) || !edits.length || edits.length > request.targets.length)
    throw Error("笔记操作清单无效。");
  const used = new Set<string>();
  const changes: NoteActionPlan["changes"] = edits.map((e) => {
    const target = request.targets.find((t) => t.ref === e?.ref);
    if (
      !target ||
      !target.ops.includes(e.op) ||
      Object.keys(e).some((k) => !["ref", "op", "text"].includes(k)) ||
      used.has(target.ref)
    )
      throw Error("操作不属于本次提问的对象或范围。");
    used.add(target.ref);
    const newText = e.op === "replace" || e.op === "append";
    if (
      newText
        ? typeof e.text !== "string" || !e.text.trim() || e.text.length > 32000
        : e.text !== undefined
    )
      throw Error("替换或追加的正文无效。");
    const { ref, ops, ...binding } = target;
    return { ...binding, operation: e.op, ...(newText ? { text: e.text } : {}) };
  });
  return { status: "pending", changes };
}
function replacement(c: NoteActionPlan["changes"][number]) {
  if (c.operation === "replace") return c.text!;
  if (c.operation === "append") return (c.start ? "\n" : "") + c.text!;
  if (c.strikeRanges?.length && (c.operation === "strike" || c.operation === "unstrike")) {
    let plain = c.expected;
    for (const span of [...c.strikeRanges].reverse()) {
      const a = span.start - c.start,
        b = span.end - c.start;
      if (
        a < 0 ||
        b > plain.length ||
        plain.slice(a, a + 2) !== "~~" ||
        plain.slice(b - 2, b) !== "~~"
      )
        throw Error("原条目的划线范围不一致，请重新提问。");
      plain = plain.slice(0, a) + plain.slice(a + 2, b - 2) + plain.slice(b);
    }
    return c.operation === "strike" ? "~~" + plain + "~~" : plain;
  }
  if (c.operation === "strike") return "~~" + c.expected + "~~";
  if (c.operation === "unstrike") {
    if (!/^~~[\s\S]+~~$/u.test(c.expected)) throw Error("原条目的划线范围不一致，请重新提问。");
    return c.expected.slice(2, -2);
  }
  throw Error("不支持此笔记修改。");
}
/** The answer receipt and every target are committed in one library compare-and-swap. */
export function applyNoteAction(
  library: KnowledgeLibrary,
  answerNoteId: string,
  answerId: string,
  at: string,
) {
  const answer = library.notes
    .find((n) => n.id === answerNoteId && !n.archivedAt)
    ?.expansions.find((e) => e.id === answerId);
  const plan = answer?.actionPlan;
  if (!plan || plan.status === "failed")
    throw Error(plan?.message ?? "操作建议已移除，请重新提问。");
  if (plan.status === "applied") return;
  const updates = new Map<string, KnowledgeNote>();
  try {
    const groups = new Map<string, NoteActionPlan["changes"]>();
    for (const c of plan.changes) {
      const group = groups.get(c.noteId) ?? [];
      group.push(c);
      groups.set(c.noteId, group);
    }
    for (const [id, changes] of groups) {
      const note = library.notes.find((n) => n.id === id && !n.archivedAt);
      if (
        !note ||
        library.deletedNoteIds?.includes(id) ||
        changes.some((c) => note.revision !== c.revision)
      )
        throw Error("目标笔记版本已变化，请按最新原文重新提问。");
      let body = note.body;
      const todos = structuredClone(note.todos ?? []);
      let before = Infinity;
      for (const c of [...changes].sort((a, b) => b.start - a.start || b.end - a.end)) {
        if (c.operation === "complete_todo" || c.operation === "reopen_todo") {
          const todo = todos.find((t) => t.id === c.todoId);
          if (!todo || todo.completedAt !== c.completedAt || todo.text !== c.label)
            throw Error("这条待办已变化，请重新核对。");
          if (c.operation === "complete_todo") todo.completedAt = at;
          else delete todo.completedAt;
        } else {
          if (
            c.start < 0 ||
            c.end > before ||
            c.end > note.body.length ||
            note.body.slice(c.start, c.end) !== c.expected
          )
            throw Error("选段已变化或多项修改重叠，请重新核对。");
          body = body.slice(0, c.start) + replacement(c) + body.slice(c.end);
          before = c.start;
        }
      }
      const changed = updateNote(
        { ...note, updatedAt: at, ...(note.todos ? { todos } : {}) },
        { title: note.title, body },
        at,
      );
      updates.set(id, changed);
    }
    library.notes = library.notes.map((note) => updates.get(note.id) ?? note);
    plan.status = "applied";
    plan.message = "已保存 " + plan.changes.length + " 项修改";
  } catch (e) {
    plan.status = "failed";
    plan.message = e instanceof Error ? e.message : "笔记未修改，请重试。";
  }
}
