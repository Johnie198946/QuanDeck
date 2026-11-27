import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeDriver } from "./driver.mjs";
import { commandInvocation } from "../agent-bridge.mjs";
import { prepareTaskWorktree, sameGitPath, verifyTaskWorktree } from "./task-worktree.mjs";

const git = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const input = {
  connectionId: "c",
  dispatchId: "d",
  projectId: "project",
  taskId: "task",
  agentId: "dsh",
  purpose: "execution",
  title: "给列表加分页",
  prompt: "hello",
};
async function project(t) {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), "quandeck-worktree-")));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, "project");
  await mkdir(source);
  git(source, "init", "--quiet");
  git(source, "config", "user.email", "fixture@example.com");
  git(source, "config", "user.name", "fixture");
  await writeFile(
    path.join(source, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0" }),
  );
  git(source, "add", "package.json");
  git(source, "commit", "--quiet", "-m", "fixture");
  return source;
}
test("task branches isolate concurrently, preserve unfinished work, and guard release version ownership", async (t) => {
  const source = await project(t);
  const [one, two] = await Promise.all([
    prepareTaskWorktree(source, input),
    prepareTaskWorktree(source, { ...input, taskId: "two" }),
  ]);
  assert.notEqual(one.branch, two.branch);
  assert.notEqual(one.directory, two.directory);
  await writeFile(path.join(one.directory, "work.js"), "draft");
  assert.deepEqual(await prepareTaskWorktree(source, input), one);
  assert.equal(await readFile(path.join(one.directory, "work.js"), "utf8"), "draft");
  assert.equal(git(source, "status", "--porcelain"), "");
  assert.equal(git(two.directory, "status", "--porcelain"), "");
  await verifyTaskWorktree(source, input, one);
  await writeFile(
    path.join(one.directory, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.1" }),
  );
  await assert.rejects(verifyTaskWorktree(source, input, one), /集成发布/);
  assert.equal(
    JSON.parse(await readFile(path.join(source, "package.json"), "utf8")).version,
    "1.0.0",
  );
});
test("new work uses a clean baseline, and retained work and explicitly read-only tasks still open", async (t) => {
  const source = await project(t);
  const one = await prepareTaskWorktree(source, input);
  await writeFile(path.join(source, "draft.txt"), "original");
  await assert.rejects(prepareTaskWorktree(source, { ...input, workItemId: "two" }), /未提交/);
  assert.equal(await readFile(path.join(source, "draft.txt"), "utf8"), "original");
  assert.deepEqual(await prepareTaskWorktree(source, input, one), one);
  assert.equal(
    await prepareTaskWorktree(source, { ...input, taskId: "ask", title: "只解释如何修改代码" }),
    undefined,
  );
  assert.equal(await prepareTaskWorktree(source, { ...input, purpose: "review" }), undefined);
  assert.equal(await prepareTaskWorktree(path.dirname(source), input), undefined);
  assert.ok(sameGitPath("c:/A/B", "C:\\a\\b", "win32"));
});
test("release evidence must include the latest source commit", async (t) => {
  const source = await project(t),
    release = { ...input, taskId: "release", title: "集成发布新版" };
  const work = await prepareTaskWorktree(source, release);
  const ordinary = await prepareTaskWorktree(source, input);
  assert.equal(work.role, "release");
  await verifyTaskWorktree(source, release, work);
  await writeFile(
    path.join(source, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.1" }),
  );
  git(source, "add", "package.json");
  git(source, "commit", "--quiet", "-m", "new baseline");
  await assert.rejects(verifyTaskWorktree(source, release, work), /项目基线已前进/);
  git(work.directory, "merge", "--ff-only", git(source, "rev-parse", "HEAD"));
  await verifyTaskWorktree(source, release, work);
  git(ordinary.directory, "merge", "--ff-only", git(source, "rev-parse", "HEAD"));
  await verifyTaskWorktree(source, input, ordinary);
  await writeFile(
    path.join(work.directory, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.30.4" }),
  );
  await assert.rejects(verifyTaskWorktree(source, release, work), /早于当前基线/);
});
test("runtime records bind native cwd across restart and retry, while preserving project connection", async (t) => {
  const source = await project(t);
  const connection = {
    connectionId: "c",
    tool: "dsh",
    binary: fileURLToPath(new URL("./fixtures/protocol-peer.mjs", import.meta.url)),
    nodePath: process.execPath,
    projectPath: source,
    provider: "deepseek-official",
    model: "test-contract",
  };
  const make = (options) =>
    createRuntimeDriver({ getConnection: () => connection, commandInvocation, ...options });
  const first = make();
  let stored;
  try {
    const receipt = await first.run(input);
    assert.ok(receipt.taskWorkspace);
    assert.equal(receipt.projectPath, receipt.taskWorkspace.directory);
    assert.equal(connection.projectPath, source);
    await first.control(receipt.runId, "stop");
    stored = first.read(receipt.runId);
  } finally {
    await first.close();
  }
  const second = make({ initialRuns: [stored] });
  try {
    assert.equal(second.read(stored.runId).projectPath, stored.taskWorkspace.directory);
    await second.control(stored.runId, "resume", { prompt: "hello" });
    await second.control(stored.runId, "stop");
    const retry = await second.run({ ...input, dispatchId: "retry" });
    assert.deepEqual(retry.taskWorkspace, stored.taskWorkspace);
    await second.verifyTaskWorkspace(retry.runId);
    const release = {
      ...input,
      dispatchId: "release-one",
      taskId: "release-one",
      title: "发布任务：整合当前成果",
    };
    const released = await second.run(release);
    const another = { ...release, dispatchId: "release-two", taskId: "release-two" };
    await assert.rejects(second.run(another), /已有集成发布任务/);
    await second.control(released.runId, "stop");
    const next = await second.run({ ...another, dispatchId: "release-two-retry" });
    assert.equal(next.taskWorkspace.role, "release");
    await assert.rejects(
      second.control(released.runId, "resume", { prompt: "继续" }),
      /已有集成发布任务/,
    );
  } finally {
    await second.close();
  }
});
