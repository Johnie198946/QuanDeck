import { hashText } from "./contentHash";
import { noteMethodMaterials, type NoteDispatchSettings } from "./noteDispatchLogic";
import type { NoteTaskOrigin } from "./repository";
import { validateTaskAttachments } from "./taskAttachments";
import type { OutputAttachment, Snapshot, Task } from "./types";

export type NoteDispatchMode = "start" | "split" | "joined" | "existing" | "conflict";
export interface NoteWork {
  request: string;
  agentId: string;
  logicKey: string;
  sourceDirectory?: string;
  units: string[];
  shared: { taskId: string; unit: string }[];
  waitsFor: string[];
}
export interface NoteWorkChange {
  id: string;
  request: string;
  at: string;
  kind: "joined" | "split" | "conflict";
  title: string;
  detail: string;
  taskId: string;
  relatedTaskIds: string[];
  noteIds: string[];
}
export interface NoteDispatchRegistration {
  ok: boolean;
  message?: string;
  taskId?: string;
  dispatchMode?: NoteDispatchMode;
}
type LinkedOrigin = NoteTaskOrigin & { dispatch: NoteDispatchSettings };

// Ordinary prose is one instruction. Splitting a conditional paragraph can reverse its meaning.
function workUnits(text: string) {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const marker = /^(?:[-*]\s+|•\s*|\d+(?:[)）、．]|\.(?!\d))\s*)/;
  const units =
    lines.length > 1 && lines.every((line) => marker.test(line))
      ? lines.map((line) => line.replace(marker, "").trim())
      : [text.trim()];
  return [...new Set(units.filter(Boolean))];
}
// Only lexical equivalents of the same action are folded. Dates, names, case,
// negation and the rest of the requested object must still match exactly.
function unitKey(text: string) {
  return text
    .trim()
    .replace(/[。；;]\s*$/u, "")
    .replace(/^(?:请帮我|请你|麻烦帮我|帮我|请)(?=核实|核对|查找|查询|撰写|编写)/u, "")
    .replace(/^(核实|核对)(?:一下)?\s*/, "核对")
    .replace(/^(查找|查询)(?:一下)?\s*/, "查找")
    .replace(/^(撰写|编写)\s*/, "编写");
}
// Distinct named files can be written in parallel. An explicit workspace change
// without a named file reserves the project against other note-dispatched writers.
function writeScope(unit: string) {
  const paths = new Set<string>();
  let unnamed = false;
  const verbs =
    /写入|输出到|写到|保存为|保存到|生成|创建|新建|修改|编辑|更新|覆盖|修复|重构|删除|\b(?:write(?:\s+to)?|save(?:\s+as)?|create|edit|update|overwrite|refactor|delete)\b/giu;
  const actions = [...unit.matchAll(verbs)];
  let pathEnd = 0;
  for (const [i, hit] of actions.entries()) {
    if (hit.index! < pathEnd) continue;
    const before = unit
      .slice(0, hit.index)
      .split(/[，。；;.!?！？\n]/u)
      .at(-1)!
      .trimEnd();
    // Reading instructions and prohibitions do not reserve their example files.
    if (
      /(?:不要|不需(?:要)?|不得|禁止|无需|不允许|不|如何|怎么|是否(?:要|需要)?|\bhow to|\bnever|\bdo not|\bdon't)\s*$/iu.test(
        before,
      )
    )
      continue;
    const afterVerb = hit.index! + hit[0].length;
    const object = unit.slice(afterVerb).trimStart();
    let next = object.replace(/^文件\s*/u, "");
    let named = false;
    let another = false;
    do {
      const quoted = /^(?:“([^”\n]+)”|「([^」\n]+)」|`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)')/u.exec(
        next,
      );
      const match =
        quoted ??
        /^(?:[A-Za-z]:)?[\w\-.\/\\\u3400-\u9fff]+?\.[a-zA-Z0-9]{1,8}(?=[\s,，。；、：:()和与的]|$)/u.exec(
          next,
        );
      const target = quoted ? quoted.slice(1).find(Boolean) : match?.[0];
      if (!target || !/\.[a-zA-Z0-9]{1,8}$/u.test(target)) {
        if (another) unnamed = true;
        break;
      }
      const path = target.replace(/\\/g, "/").normalize("NFC").toLowerCase(),
        parts: string[] = [];
      for (const component of path.split("/")) {
        if (!component || component === ".") continue;
        if (component === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
        else parts.push(component);
      }
      paths.add((path.startsWith("/") ? "/" : "") + parts.join("/"));
      named = true;
      const rest = next.slice(match![0].length);
      pathEnd = unit.length - rest.length;
      const conjunction = /^\s*(?:、|和|与|\band\b)\s*/iu.exec(rest);
      another = !!conjunction;
      next = conjunction ? rest.slice(conjunction[0].length) : "";
    } while (another);
    if (named) continue;
    const clause = unit
      .slice(afterVerb, actions[i + 1]?.index)
      .trim()
      .split(/[，。；;!?！？\n]/u)[0];
    if (/^(?:一[份段个张]?)?(?:文件列表|代码示例|代码片段|配置示例|脚本示例)/u.test(clause))
      continue;
    if (
      (/^(?:写入|输出到|写到|保存为|保存到|覆盖)$/u.test(hit[0]) &&
        !/^(?:对话|回复|聊天|消息|回答|屏幕)/u.test(clause)) ||
      /文件|代码|源码|配置|脚本|工作区|项目目录|\bREADME\b|^[\w*?./\\-]+\.[a-z0-9]{1,8}\b|\b(?:files?|code|config(?:uration)?|scripts?|workspace|director(?:y|ies))\b/iu.test(
        clause,
      )
    )
      unnamed = true;
  }
  return { paths, unnamed };
}
function active(snapshot: Snapshot, task: Task) {
  const row = snapshot.collaboration?.tasks[task.id];
  return (
    !task.completion &&
    !row?.archived &&
    row?.status !== "done" &&
    row?.status !== "cancelled" &&
    row?.status !== "failed"
  );
}
function peerUnits(task: Task) {
  return task.noteWork?.units ?? workUnits(task.title);
}
function taskMethods(task: Task) {
  return (task.inputs ?? []).filter(input => input.noteSource).map(input => noteMethodMaterials(input.noteLogic, input.noteCustomTags)).join("\n");
}
function assigned(s: Snapshot, task: Task) {
  return !!(
    task.noteWork ||
    task.owner === "agent" ||
    task.sessionIds.some((id) => s.sessions[id]?.origin === "dispatch")
  );
}
function executor(s: Snapshot, task: Task) {
  const id =
    task.noteWork?.agentId ??
    task.sessionIds.map((id) => s.sessions[id]).find((session) => session?.origin === "dispatch")
      ?.agentId;
  return s.agents.find((agent) => agent.id === id)?.short || (id === "codex" ? "Codex" : id);
}
function writeConflict(a: string, b: string, bothNotes: boolean) {
  const first = writeScope(a),
    second = writeScope(b);
  for (const path of first.paths) if (second.paths.has(path)) return "共同写入 " + path;
  if (
    bothNotes &&
    ((first.unnamed && (second.unnamed || second.paths.size > 0)) ||
      (second.unnamed && first.paths.size > 0))
  )
    return "同一项目中有写入任务尚未指明目标文件";
}
function sourceNotes(tasks: Task[]) {
  return [
    ...new Set(
      tasks.flatMap((task) =>
        (task.inputs ?? []).flatMap((input) => (input.noteSource ? [input.noteSource.noteId] : [])),
      ),
    ),
  ];
}
function record(
  snapshot: Snapshot,
  data: Omit<NoteWorkChange, "id" | "at" | "noteIds">,
  tasks: Task[],
) {
  const id = "division-" + hashText(data.request);
  if (!snapshot.noteWorkChanges?.some((change) => change.id === id))
    (snapshot.noteWorkChanges ??= []).push({
      ...data,
      id,
      at: new Date().toISOString(),
      noteIds: sourceNotes(tasks),
    });
}
function scopeSignature(logic: NoteDispatchSettings["logic"], files: OutputAttachment[], customTags: string[] = []) {
  const selection = customTags.length ? {logic, customTags} : logic;
  return hashText(
    JSON.stringify(
      files.length ? [selection, [...files].sort((a, b) => a.id.localeCompare(b.id))] : selection,
    ),
  );
}
const defaultScope = scopeSignature([], []);
// Keep legacy request keys for ordinary project dispatch. An explicit directory is part of
// the user's request even while desktop validation is pending or a previous attempt failed.
function directoryKey(path?: string) {
  if (!path) return undefined;
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(path);
  const normalized = windows ? path.replace(/\\/g, "/").replace(/^[a-z]:/i, drive => drive.toUpperCase()) : path;
  return normalized.replace(/\/+$/, "") || "/";
}
function projectDirectory(s: Snapshot, agentId: string) {
  return directoryKey(s.project.workspacePath ?? s.runtimeConnections?.[agentId]?.projectPath);
}
function workDirectory(s: Snapshot, task: Task) {
  const chosen = task.sourceDirectory?.path ?? task.noteWork?.sourceDirectory;
  if (chosen) return directoryKey(chosen);
  const execution = task.sessionIds.slice().reverse().map(id => s.sessions[id])
    .find(session => session?.runtime?.purpose === "execution" && !session.runtime.workItemId);
  return directoryKey(execution?.runtime?.connection?.projectPath) ??
    projectDirectory(s, task.noteWork?.agentId ?? execution?.agentId ?? s.defaultAgent);
}
function methodMatches(s: Snapshot, task: Task, key: string) {
  const inputs = task.inputs ?? [];
  if (
    inputs.some((input) => !input.noteSource) ||
    (s.collaboration?.tasks[task.id]?.specRevision ?? 1) > 1
  )
    return false;
  if (task.noteWork) return task.noteWork.logicKey === key;
  if (task.attachments?.length || inputs.some((input) => input.noteLogic?.length || input.noteCustomTags?.length)) return false;
  const spec = s.collaboration?.specs.find((row) => row.key === task.id && row.revision === 1);
  return (
    key === defaultScope &&
    (!spec ||
      (spec.goal === task.title && ["existing-task-import", "task-created"].includes(spec.reason)))
  );
}
function link(
  task: Task,
  origin: LinkedOrigin,
  text: string,
  request: string,
  files: OutputAttachment[],
) {
  const inputs = (task.inputs ??= []);
  if (inputs.some((row) => row.id === request)) return;
  if (files.length) {
    const attached = task.attachments ?? [];
    if (
      files.some((file) =>
        attached.some((old) => old.id === file.id && JSON.stringify(old) !== JSON.stringify(file)),
      )
    )
      throw Error("附件记录已变化，请重新添加");
    task.attachments = validateTaskAttachments([
      ...attached,
      ...files.filter((file) => !attached.some((old) => old.id === file.id)),
    ]);
  }
  inputs.push({
    id: request,
    ...(files.length && { attachments: structuredClone(files) }),
    text: "来自笔记《" + (origin.title || "未命名") + "》\n" + text,
    at: new Date().toISOString(),
    noteSource: structuredClone(origin.noteSource),
    noteLogic: structuredClone(origin.dispatch.logic),
    ...(origin.dispatch.customTags?.length && {noteCustomTags:[...origin.dispatch.customTags]}),
  });
}

/** Must run synchronously inside the existing single project mutation, before any driver call. */
export function registerNoteWork(
  s: Snapshot,
  text: string,
  origin: LinkedOrigin,
  create: (title: string) => Task,
  files: OutputAttachment[] = [],
): NoteDispatchRegistration {
  const logicKey = scopeSignature(origin.dispatch.logic, files, origin.dispatch.customTags);
  const directory = directoryKey(origin.sourceDirectory);
  const request = "send-" + hashText(JSON.stringify(directory ? [origin.key, logicKey, directory] : [origin.key, logicKey]));
  const effectiveDirectory = directory ?? projectDirectory(s, origin.dispatch.agentId);
  const tasks = Object.values(s.tasks).filter(task => workDirectory(s, task) === effectiveDirectory);
  const started = tasks.find((task) => task.noteWork?.request === request);
  const prior = s.noteWorkChanges?.find(
    (change) => change.request === request && tasks.some(task => task.id === change.taskId),
  );
  if (started)
    return {
      ok: true,
      taskId: started.id,
      dispatchMode: noteWorkGuard(s, started.id) ? "conflict" : "existing",
      message: prior?.detail,
    };
  if (prior)
    return { ok: true, taskId: prior.taskId, dispatchMode: "joined", message: prior.detail };
  const saved = tasks.find(
    (task) =>
      !task.noteWork &&
      active(s, task) &&
      !task.sessionIds.length &&
      task.inputs?.some(
        (row) =>
          row.id === origin.key &&
          scopeSignature(row.noteLogic ?? [], row.attachments ?? task.attachments ?? [], row.noteCustomTags) ===
            logicKey,
      ),
  );
  const peers = tasks.filter((task) => task !== saved && active(s, task) && assigned(s, task));
  const methodText = noteMethodMaterials(origin.dispatch.logic, origin.dispatch.customTags);
  const peerMethods = new Map(peers.map(peer => [peer.id, taskMethods(peer)]));
  const mine: string[] = [],
    shared: NoteWork["shared"] = [],
    waits = new Map<string, string>();
  for (const unit of workUnits(text)) {
    let matched: Task | undefined;
    const conflicts = new Map<string, string>();
    for (const peer of peers)
      for (const theirs of peerUnits(peer)) {
        const exact = unitKey(theirs) === unitKey(unit);
        if (exact && methodMatches(s, peer, logicKey)) matched ??= peer;
        else {
          const reason = writeConflict(unit+"\n"+methodText, theirs+"\n"+peerMethods.get(peer.id), !!peer.noteWork);
          if (reason || exact) conflicts.set(peer.id, reason ?? "相同事项的做法或资料不同");
        }
      }
    if (matched) shared.push({ taskId: matched.id, unit });
    else {
      mine.push(unit);
      for (const [id, reason] of conflicts) waits.set(id, reason);
    }
  }
  const related = peers.filter(
    (task) => shared.some((row) => row.taskId === task.id) || waits.has(task.id),
  );
  const sharedTasks = related.filter((task) => shared.some((row) => row.taskId === task.id));
  for (const peer of sharedTasks) link(peer, origin, text, request, files);
  const incumbents = sharedTasks.map((peer) => {
    const name = executor(s, peer);
    return (
      (name ? name + "（原任务）" : "原任务") +
      "继续负责「" +
      shared
        .filter((row) => row.taskId === peer.id)
        .map((row) => row.unit)
        .join("、") +
      "」。"
    );
  });
  if (!mine.length && !waits.size && sharedTasks.length) {
    const main = sharedTasks[0],
      detail = incumbents.join("\n") + " 结果会回到这段笔记。";
    record(
      s,
      {
        request,
        taskId: main.id,
        relatedTaskIds: sharedTasks.map((t) => t.id),
        kind: "joined",
        title: "相同事项已交给原任务",
        detail,
      },
      sharedTasks,
    );
    return { ok: true, taskId: main.id, message: detail, dispatchMode: "joined" };
  }
  const title = mine.length > 1 ? mine.map((x) => "- " + x).join("\n") : mine[0] || text;
  const task = saved ?? create(title);
  if (saved && shared.length) task.title = title;
  task.owner = "agent";
  task.noteWork = {
    request,
    logicKey,
    ...(directory && {sourceDirectory: directory}),
    agentId: origin.dispatch.agentId,
    units: mine,
    shared,
    waitsFor: [...waits.keys()],
  };
  link(task, origin, text, request, files);
  if (!related.length) return { ok: true, taskId: task.id, dispatchMode: "start" };
  const conflict = waits.size > 0,
    detail = [
      ...[...waits].map(([id, why]) => why + "，先等「" + s.tasks[id].title + "」完成。"),
      ...incumbents,
      mine.length
        ? (executor(s, task) || "新任务") +
          (conflict ? " 等待后处理" : " 本次只做") +
          "「" +
          mine.join("、") +
          "」。"
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  const kind = conflict ? "conflict" : "split";
  record(
    s,
    {
      request,
      taskId: task.id,
      relatedTaskIds: related.map((t) => t.id),
      kind,
      title: conflict ? "执行范围需要协调" : "重复部分已让给原任务",
      detail,
    },
    [task, ...related],
  );
  return { ok: true, taskId: task.id, dispatchMode: kind, message: detail };
}

function executing(s: Snapshot, peer: Task) {
  const claimId = s.collaboration?.tasks[peer.id]?.activeRunId;
  const claim = claimId && s.collaboration?.runs[claimId];
  if (
    claim &&
    claim.purpose === "execution" &&
    !["succeeded", "failed", "cancelled", "lost"].includes(claim.status)
  )
    return true;
  return peer.sessionIds.some((id) => {
    const session = s.sessions[id];
    return (
      session?.runtime?.purpose === "execution" &&
      (session.dispatchPhase === "unknown" ||
        !["done", "archived", "failed", "cancelled"].includes(session.status) ||
        session.runtime.stoppedConfirmed === false)
    );
  });
}

export function noteWorkGuard(s: Snapshot, taskId: string): string | undefined {
  const task = s.tasks[taskId];
  if (!task) return;
  const work = task.noteWork;
  const writers = Object.values(s.tasks).filter((peer) => {
    if (peer === task || workDirectory(s, peer) !== workDirectory(s, task) || (!work && !peer.noteWork)) return false;
    return executing(s, peer);
  });
  const methodText = taskMethods(task);
  const writerMethods = new Map(writers.map(peer=>[peer.id,taskMethods(peer)]));
  for (const unit of peerUnits(task))
    for (const peer of writers)
      for (const theirs of peerUnits(peer)) {
        if (unitKey(unit) === unitKey(theirs))
          return "「" + unit + "」已经有人在做，请查看原任务。";
        const reason = writeConflict(unit+"\n"+methodText, theirs+"\n"+writerMethods.get(peer.id), !!work && !!peer.noteWork);
        if (reason) return reason + "，请等「" + peer.title + "」结束后再写入。";
      }
  if (!work) return;
  const blockers = work.waitsFor.map((id) => s.tasks[id]).filter((peer) => peer && workDirectory(s, peer) === workDirectory(s, task) && active(s, peer));
  if (blockers.length)
    return (
      "执行范围与「" + blockers.map((t) => t.title).join("、") + "」重叠，请等原任务结束后再执行。"
    );
  if (!work.units.length) return "此任务的事项均已由其他任务承接，请查看分工记录。";
}

export function renderNoteWorkBoundary(s: Snapshot, taskId: string) {
  const task = s.tasks[taskId],
    work = task?.noteWork;
  if (!work) return "";
  const peers = Object.values(s.tasks).filter(
    (t) => t.id !== taskId && workDirectory(s, t) === workDirectory(s, task) && active(s, t) && (t.noteWork || t.owner === "agent"),
  );
  return [
    "下列各项来自选中的笔记，包含需求和背景。只执行以下认领事项。",
    ...work.units.map((unit) => "- " + unit),
    ...work.shared.map((row) => "已由 " + row.taskId + " 负责，不要重复：" + row.unit),
    ...peers
      .slice(0, 16)
      .map((peer) => "同项目任务 " + peer.id + "：" + peerUnits(peer).join("；").slice(0, 240)),
    '发现重复时，先停做争议部分。用 checkpoint 的 overlap 字段报告 {"taskId":"对方任务编号","mine":"本次完整条目","theirs":"对方完整条目","reason":"为何重叠"}，只继续无争议事项。不要更改别人的文件。',
  ].join("\n");
}

export function noteWorkBoard(s: Snapshot) {
  const tasks = Object.values(s.tasks).filter((task) => task.noteWork && active(s, task));
  if (!tasks.length && !s.noteWorkChanges?.length) return "";
  return [
    "## 笔记派工分工",
    ...tasks.map(
      (task) =>
        "- " +
        task.id +
        " · " +
        task.noteWork!.agentId +
        " · " +
        task.noteWork!.units.join("；") +
        (task.noteWork!.waitsFor.some((id) => s.tasks[id] && workDirectory(s, s.tasks[id]) === workDirectory(s, task) && active(s, s.tasks[id]))
          ? " · 等待协调"
          : ""),
    ),
    ...(s.noteWorkChanges ?? []).slice(-8).map((row) => "- " + row.title + "：" + row.detail),
  ].join("\n");
}

function shareUnit(task: Task, peer: Task, unit: string) {
  const work = task.noteWork!;
  work.units = work.units.filter((line) => unitKey(line) !== unitKey(unit));
  if (!work.shared.some((row) => row.taskId === peer.id && unitKey(row.unit) === unitKey(unit)))
    work.shared.push({ taskId: peer.id, unit });
  for (const source of task.inputs ?? [])
    if (source.noteSource && !(peer.inputs ?? []).some((input) => input.id === source.id))
      (peer.inputs ??= []).push(structuredClone(source));
}

/** A bound worker may discover a substep after dispatch. Match its own proposed next steps
 * against actual project reservations, even when its original prompt predates those peers. */
export function reconcileNoteCheckpoint(s: Snapshot, taskId: string, remaining: string[]) {
  const task = s.tasks[taskId],
    work = task?.noteWork;
  if (!work || !remaining.length) return remaining;
  const peers = Object.values(s.tasks).filter(
    (peer) => peer !== task && workDirectory(s, peer) === workDirectory(s, task) && active(s, peer) && (peer.noteWork || executing(s, peer)),
  );
  const retained: string[] = [];
  for (const unit of remaining) {
    if (work.shared.some((entry) => unitKey(entry.unit) === unitKey(unit))) continue;
    const matches = peers.filter((peer) =>
      peerUnits(peer).some((theirs) => unitKey(theirs) === unitKey(unit)),
    );
    const owner = matches.find((peer) => methodMatches(s, peer, work.logicKey));
    if (!owner) {
      if (matches.length)
        record(
          s,
          {
            request: JSON.stringify(["checkpoint-conflict", taskId, matches[0].id, unitKey(unit)]),
            taskId,
            relatedTaskIds: matches.map((peer) => peer.id),
            kind: "conflict",
            title: "执行步骤有不同做法",
            detail: "「" + unit + "」也在其他任务中，做法或资料有差异，请查看双方分工。",
          },
          [task, ...matches],
        );
      retained.push(unit);
      continue;
    }
    shareUnit(task, owner, unit);
    const ownerName = executor(s, owner) || "原任务";
    record(
      s,
      {
        request: JSON.stringify(["checkpoint-step", taskId, owner.id, unitKey(unit)]),
        taskId,
        relatedTaskIds: [owner.id],
        kind: "split",
        title: "执行中已让出重复步骤",
        detail: ownerName + " 负责「" + unit + "」。本次跳过这一步，结果会回到原笔记。",
      },
      [task, owner],
    );
  }
  return retained;
}

/** Claims can only narrow the reporter's own scope, and never transfer authority over a peer. */
export function checkpointOverlap(s: Snapshot, id: string, value: unknown) {
  const row = value as Record<string, unknown> | null;
  if (
    !row ||
    !["taskId", "mine", "theirs", "reason"].every(
      (key) =>
        typeof row[key] === "string" &&
        (row[key] as string).trim() &&
        (row[key] as string).length <= 2000,
    ) ||
    Object.keys(row).some((key) => !["taskId", "mine", "theirs", "reason"].includes(key))
  )
    throw Error("分工回报缺少任务编号、双方条目或原因");
  const task = s.tasks[id],
    peer = s.tasks[row.taskId as string];
  if (
    !task?.noteWork ||
    !peer ||
    id === peer.id ||
    workDirectory(s, task) !== workDirectory(s, peer) ||
    !active(s, task) ||
    !active(s, peer) ||
    !assigned(s, peer) ||
    !peerUnits(peer).includes(row.theirs as string) ||
    !task.noteWork.units.includes(row.mine as string)
  )
    throw Error("项目中没有这两个仍有效的认领条目");
  const unit = row.mine as string,
    theirs = row.theirs as string;
  const request = JSON.stringify(["report", id, peer.id, unit, theirs]);
  const exact = unitKey(unit) === unitKey(theirs) && methodMatches(s, peer, task.noteWork.logicKey);
  if (exact) shareUnit(task, peer, unit);
  const detail =
    (exact
      ? (executor(s, peer) || "原任务") +
        " 接手「" +
        unit +
        "」。" +
        (task.noteWork.units.length
          ? (executor(s, task) || "本任务") + " 只做「" + task.noteWork.units.join("、") + "」。"
          : "本次无需再做。")
      : "「" + unit + "」与「" + theirs + "」可能重叠。") +
    " 原因：" +
    row.reason;
  record(
    s,
    {
      request,
      taskId: id,
      relatedTaskIds: [peer.id],
      title: exact ? "执行中已让出重复事项" : "执行中发现可能重叠",
      kind: exact ? "split" : "conflict",
      detail,
    },
    [task, peer],
  );
}
