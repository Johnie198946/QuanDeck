import assert from "node:assert/strict";
import { LocalWorkdeckDataSource } from "../src/data/repository";
import {
  type CollaborationActor,
  type CollaborationCommand,
  applyCollaboration,
  ensureCollaboration,
  exportCollaboration,
} from "../src/data/collaboration";
import { noteWorkGuard, renderNoteWorkBoundary } from "../src/data/noteWorkSharing";
import { noteTaskKey } from "../src/data/noteTaskSource";
import { findNoteLogicGroups, noteLogicPrompt, validNoteDispatch, type NoteLogicStep } from "../src/data/noteDispatchLogic";
import type { Snapshot } from "../src/data/types";

const memory = new Map<string, string>();
let failSave = false;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failSave) throw new Error("disk full");
      memory.set(k, v);
    },
    removeItem: (k: string) => memory.delete(k),
  },
});
let seq = 0;
function act(
  s: Snapshot,
  id: string,
  type: CollaborationCommand["type"],
  payload: Record<string, unknown>,
  actor: CollaborationActor = { kind: "service" },
  key = "call" + ++seq,
) {
  const c = ensureCollaboration(s);
  return applyCollaboration(
    s,
    {
      projectId: s.project.id,
      taskId: id,
      expectedVersion: c.tasks[id].version,
      type,
      idempotencyKey: key,
      payload,
    },
    actor,
  );
}
async function main() {
  const api = new LocalWorkdeckDataSource();
  const projectId = (await api.createProject({ name: "京都" })).projectId!;
  const settings = (note: string, text: string, logic: NoteLogicStep[] = []) => ({
    key: noteTaskKey(note, 0, text),
    title: note,
    noteSource: { noteId: note, lineIndex: 0 },
    dispatch: { agentId: "codex", logic },
  });
  const send = (note: string, text: string, logic: NoteLogicStep[] = []) =>
    api.createTaskWithAttachments(text, [], projectId, settings(note, text, logic));
  const [first, second] = await Promise.all([
    send("a", "核对京都班次"),
    send("b", "请核实一下京都班次"),
  ]);
  assert.equal(first.dispatchMode, "start");
  assert.equal(second.dispatchMode, "joined");
  assert.equal(second.taskId, first.taskId);
  const firstId = first.taskId!;
  let snapshot = await api.load();
  assert.deepEqual(snapshot.noteWorkChanges?.[0].noteIds.sort(), ["a", "b"]);
  const split = await send("c", "- 核对京都班次\n- 比较酒店价格");
  assert.equal(split.dispatchMode, "split");
  snapshot = await api.load();
  assert.deepEqual(snapshot.tasks[split.taskId!].noteWork?.units, ["比较酒店价格"]);
  assert.deepEqual(
    snapshot.tasks[firstId].inputs?.map((i) => i.noteSource?.noteId),
    ["a", "b", "c"],
  );
  assert(!noteWorkGuard(snapshot, split.taskId!));
  assert((await send("c", "- 核对京都班次\n- 比较酒店价格")).dispatchMode === "existing");
  const restored = new LocalWorkdeckDataSource();
  const restoredSnapshot = await restored.load();
  assert.deepEqual(restoredSnapshot.noteWorkChanges, snapshot.noteWorkChanges);
  assert.equal(
    (
      await restored.createTaskWithAttachments(
        "请核实一下京都班次",
        [],
        projectId,
        settings("b", "请核实一下京都班次"),
      )
    ).dispatchMode,
    "joined",
  );
  assert.equal((await restored.load()).tasks[firstId].inputs?.length, 3);
  const exported = exportCollaboration(restoredSnapshot);
  assert.match(exported.ledger, /比较酒店价格/);
  assert.match(exported.blackboard, /重复部分已让给原任务/);
  const alternative: NoteLogicStep[] = [
    {
      id: "edge",
      from: "1",
      to: "2",
      fromTitle: "京都",
      toTitle: "大阪",
      label: "前往",
      detail: "依照车次",
    },
  ];
  const tagged = { ...settings("labels","汇总票价",alternative), customTags:["只写人民币"] };
  const selected = {...tagged,dispatch:{...tagged.dispatch,customTags:tagged.customTags}};
  assert(validNoteDispatch(selected.dispatch));
  assert(!validNoteDispatch({...selected.dispatch,customTags:[""]}));
  const taggedSend = await api.createTaskWithAttachments("汇总票价",[],projectId,selected);
  assert.equal(taggedSend.dispatchMode,"start");
  assert.deepEqual((await api.load()).tasks[taggedSend.taskId!].inputs![0].noteCustomTags,tagged.customTags);
  const changed = await api.createTaskWithAttachments("汇总票价",[],projectId,{
    ...selected,dispatch:{...selected.dispatch,customTags:["只写日元"]}
  });
  assert.equal(changed.dispatchMode,"conflict","a changed user instruction requires its own scope");
  const otherText="核对景点";
  const other=settings("shared-path",otherText);
  const taggedWriter=await api.createTaskWithAttachments(otherText,[],projectId,{...other,dispatch:{...other.dispatch,customTags:["写入 routes.csv"]}});
  assert.equal(taggedWriter.dispatchMode,"start");
  assert.equal((await send("path-overlap","修改 routes.csv 的首行")).dispatchMode,"conflict");
  const prompt = noteLogicPrompt(alternative,tagged.customTags);
  assert.match(prompt,/依照车次/);
  assert.match(prompt,/用户补充\n- 只写人民币/);
  const group = {id:"r",noteIds:["1","2"],title:"京都 → 大阪",steps:alternative};
  assert.deepEqual(findNoteLogicGroups([group],"京阪 依车"),[group]);
  assert.deepEqual(findNoteLogicGroups([group],"冰岛"),[]);
  const held = await send("d", "核对京都班次", alternative);
  assert.equal(held.dispatchMode, "conflict");
  snapshot = await api.load();
  assert.equal(
    act(snapshot, held.taskId!, "claim", { executor: "codex" }).code,
    "NOTE_WORK_OVERLAP",
  );
  assert.equal((await send("e", "不要核对京都班次")).dispatchMode, "start");
  const file = await send("f", "更新 trip.md 的班次");
  assert.equal(file.dispatchMode, "start");
  const writer = await send("g", "修改 trip.md 的住宿");
  assert.equal(writer.dispatchMode, "conflict");
  const quotedFile = await send("path1", "更新「资料/我的 交通.xlsx」");
  assert.equal(quotedFile.dispatchMode, "start");
  assert.equal((await send("path2", "修改“资料/旧/../我的 交通.xlsx”")).dispatchMode, "conflict");
  const lateWriter = (await api.createTaskWithAttachments("编辑 trip.md 的图例", [], projectId))
    .taskId!;
  await api.setTaskOwner(lateWriter, "agent");
  snapshot = await api.load();
  assert(act(snapshot, file.taskId!, "claim", { executor: "codex", runId: "file-owner" }).ok);
  assert.equal(
    act(snapshot, lateWriter, "claim", { executor: "codex", runId: "late-writer" }).code,
    "NOTE_WORK_OVERLAP",
  );
  const read = await send("h", "阅读 trip.md 的住宿");
  assert.equal(read.dispatchMode, "start");
  failSave = true;
  await assert.rejects(send("failed", "核对京都班次"), /未保存/);
  failSave = false;
  assert(
    !(await api.load()).tasks[firstId].inputs?.some(
      (input) => input.noteSource?.noteId === "failed",
    ),
  );
  const p2 = (await api.createProject({ name: "独立项目" })).projectId!;
  assert.equal(
    (await api.createTaskWithAttachments("核对京都班次", [], p2, settings("a", "核对京都班次")))
      .dispatchMode,
    "start",
  );
  assert(!(await api.load()).noteWorkChanges?.length);
  const writersProject = (await api.createProject({ name: "写入范围检查" })).projectId!;
  const dispatchWriter = (text: string) =>
    api.createTaskWithAttachments(text, [], writersProject, settings(text, text));
  const knownA = await dispatchWriter("编辑 a.md 的日期");
  const knownB = await dispatchWriter("编辑 b.md 的署名");
  assert.equal(knownA.dispatchMode, "start");
  assert.equal(knownB.dispatchMode, "start");
  const moreNamed = await dispatchWriter("更新 edit.md和d.md");
  assert.equal(moreNamed.dispatchMode, "start");
  assert.equal((await dispatchWriter("修改 d.md 的日期")).dispatchMode, "conflict");
  const unnamed = await dispatchWriter("修改项目配置文件");
  assert.equal(unnamed.dispatchMode, "conflict");
  assert.match(unnamed.message!, /尚未指明目标文件/);
  assert.equal((await dispatchWriter("更新 c.md 的内容")).dispatchMode, "conflict");
  const anotherUnnamed = await dispatchWriter("重构旧版代码");
  assert.equal(anotherUnnamed.dispatchMode, "conflict");
  for (const text of [
    "阅读 a.md 并总结",
    "撰写摘要",
    "生成一段回复",
    "生成代码示例",
    "说明如何修改配置文件",
    "不要修改项目配置文件",
  ]) {
    assert.equal((await dispatchWriter(text)).dispatchMode, "start", text);
  }
  const heldSnapshot = await new LocalWorkdeckDataSource().load();
  assert(heldSnapshot.tasks[unnamed.taskId!].noteWork!.waitsFor.includes(knownA.taskId!));
  assert(heldSnapshot.tasks[unnamed.taskId!].noteWork!.waitsFor.includes(knownB.taskId!));
  assert(
    heldSnapshot.noteWorkChanges!.some(
      (change) => change.taskId === unnamed.taskId && change.kind === "conflict",
    ),
  );
  assert(act(heldSnapshot, knownA.taskId!, "claim", { executor: "codex" }).ok);
  assert(act(heldSnapshot, knownB.taskId!, "claim", { executor: "codex" }).ok);
  // Pre-existing reservations need the same check at claim, even without a saved wait.
  heldSnapshot.tasks[unnamed.taskId!].noteWork!.waitsFor = [];
  assert.equal(
    act(heldSnapshot, unnamed.taskId!, "claim", { executor: "codex" }).code,
    "NOTE_WORK_OVERLAP",
  );
  await api.switchProject(projectId);
  const testText = "- 核对京都站时间\n- 汇总行李限额";
  const live = await send("live", testText);
  const manual = (await api.createTaskWithAttachments("请帮我核实一下京都站时间", [], projectId))
    .taskId!;
  await api.setTaskOwner(manual, "agent");
  snapshot = await api.load();
  const id = live.taskId!;
  const claim = act(snapshot, id, "claim", { executor: "codex", runId: "run-test" });
  assert(claim.ok, claim.message);
  assert.match(claim.context!.prompt, /汇总行李限额/);
  assert.match(claim.context!.prompt, /请帮我核实一下京都站时间/);
  const actor: CollaborationActor = {
    kind: "runtime",
    runId: "run-test",
    claimEpoch: snapshot.collaboration!.runs["run-test"].claimEpoch,
  };
  const checkpoint = {
    runId: "run-test",
    completed: [],
    remaining: ["汇总行李限额"],
    note: "改做其余工作",
    overlap: {
      taskId: manual,
      mine: "核对京都站时间",
      theirs: "请帮我核实一下京都站时间",
      reason: "同一站同一时间核查",
    },
  };
  assert.equal(
    act(
      snapshot,
      id,
      "checkpoint",
      { ...checkpoint, overlap: { ...checkpoint.overlap, taskId: "other-project" } },
      actor,
    ).ok,
    false,
  );
  const report = act(snapshot, id, "checkpoint", checkpoint, actor, "checkpoint-1");
  assert(report.ok, report.message);
  assert.deepEqual(snapshot.tasks[id].noteWork?.units, ["汇总行李限额"]);
  assert.match(renderNoteWorkBoundary(snapshot, id), /不要重复：核对京都站时间/);
  assert.equal(snapshot.tasks[manual].inputs?.at(-1)?.noteSource?.noteId, "live");
  assert.equal(snapshot.noteWorkChanges?.at(-1)?.kind, "split");
  const uncertain = act(
    snapshot,
    id,
    "checkpoint",
    {
      ...checkpoint,
      overlap: { ...checkpoint.overlap, mine: "汇总行李限额", reason: "两份旅行材料可能相近" },
    },
    actor,
  );
  assert(uncertain.ok, uncertain.message);
  assert.deepEqual(snapshot.tasks[id].noteWork?.units, ["汇总行李限额"]);
  assert.equal(snapshot.noteWorkChanges?.at(-1)?.kind, "conflict");
  const luggage = (await api.createTaskWithAttachments("汇总行李限额", [], projectId)).taskId!;
  await api.setTaskOwner(luggage, "agent");
  const registered = await api.load();
  snapshot.tasks[luggage] = structuredClone(registered.tasks[luggage]);
  ensureCollaboration(snapshot);
  const ceded = act(
    snapshot,
    id,
    "checkpoint",
    {
      ...checkpoint,
      remaining: [],
      overlap: {
        taskId: luggage,
        mine: "汇总行李限额",
        theirs: "汇总行李限额",
        reason: "原任务已包含同一交付",
      },
    },
    actor,
  );
  assert(ceded.ok, ceded.message);
  assert(noteWorkGuard(snapshot, id));
  assert.equal(
    act(snapshot, id, "submit", { title: "重复回报", body: "不要覆盖原任务" }, actor).code,
    "NOTE_WORK_OVERLAP",
  );
  const plan = await send("plan", "规划京都行程，整理交通和住宿");
  snapshot = await api.load();
  const planId = plan.taskId!;
  const planClaim = act(snapshot, planId, "claim", { executor: "codex", runId: "plan-run" });
  assert(planClaim.ok, planClaim.message);
  const generatedStep = act(
    snapshot,
    planId,
    "checkpoint",
    {
      runId: "plan-run",
      note: "发现需要核对具体班次",
      completed: [],
      remaining: ["请核对京都班次", "收集酒店地址"],
    },
    {
      kind: "runtime",
      runId: "plan-run",
      claimEpoch: snapshot.collaboration!.runs["plan-run"].claimEpoch,
    },
  );
  assert(generatedStep.ok, generatedStep.message);
  assert.deepEqual(snapshot.collaboration!.checkpoints.at(-1)?.remaining, ["收集酒店地址"]);
  assert.deepEqual(snapshot.tasks[planId].noteWork?.units, ["规划京都行程，整理交通和住宿"]);
  assert.match(renderNoteWorkBoundary(snapshot, planId), /不要重复：请核对京都班次/);
  assert.equal(snapshot.noteWorkChanges?.at(-1)?.title, "执行中已让出重复步骤");
  console.log(
    "note work sharing: concurrent ownership, exact and partial joins, durable notices and rollback, project isolation, write conflicts, and authenticated mid-run changes",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
