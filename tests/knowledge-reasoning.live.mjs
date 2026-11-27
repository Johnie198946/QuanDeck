import { createRuntimeDriver } from "../scripts/runtime/driver.mjs";
import { commandInvocation } from "../scripts/agent-bridge.mjs";
import { createKnowledgeGraphGenerator } from "../desktop/app/knowledge-graph-agent.mjs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const connector = {
  tool: "codex",
  connectionId: "qa-synthetic",
  model: process.env.QUANDECK_EVAL_MODEL || "gpt-6.1-sol",
  binary: process.env.QUANDECK_CODEX_BINARY ?? "codex",
  projectPath: await mkdtemp(join(tmpdir(), "qd-ideas-eval-")),
};
const outputDir = new URL("../output/knowledge-reasoning/", import.meta.url);
await mkdir(outputDir, { recursive: true });
const driver = createRuntimeDriver({ getConnection: () => connector, commandInvocation });
const notes = [
  [
    "compute",
    "服务调度试验",
    "TokenOps 每隔五分钟依响应耗时和队列长度切换到备用模型；只有连续两次越界才切换，防止来回跳动。",
  ],
  [
    "outing",
    "雨天带孩子出门",
    "旅行中有三处可替换的室内活动。等位太久或遇到大雨时想改走下一处，又不想一天不停改行程。",
  ],
  ["deadline1", "场馆书面通知", "本周六植物馆东门最后入场时间是 17:00，以到达入口为准。"],
  ["deadline2", "东门预约单", "本周六植物馆东门最后入场时间是 16:00，以到达入口为准。"],
  [
    "shuttle",
    "接驳车记录",
    "室内备选活动之间有免费接驳，每半小时一班；只有在整点或半点才能更换地点。",
  ],
  ["decoy", "数字与旧物", "收藏的明信片上画了东门，印着编号 1700；这批卡片按纸张厚度分组。"],
].map(([id, title, body]) => ({
  id,
  title,
  body,
  at: "2026-11-23",
  updatedAt: "2026-11-23T12:00:00Z",
  revision: 1,
  expansions: [],
}));
const library = { notes, decisions: [] };
let requests = 0;
const generate = createKnowledgeGraphGenerator({
  readLibrary: () => library,
  saveGraph: (l, g) => (l.agentGraph = g),
  readConfigured: () => [connector],
  connections: () => [connector],
  assist: async (req) => {
    const start = Date.now();
    let r;
    try {
      r = await driver.assist(req);
    } catch (e) {
      console.error(
        "request failed",
        e.code,
        e.message,
        e.sourceSessionId,
        e.modelRetried,
        e.modelProgressed,
      );
      throw e;
    }
    console.log("response", ++requests, (Date.now() - start) / 1000, r.sourceSessionId);
    return r;
  },
});
try {
  await generate();
  const { reasoning, edges } = library.agentGraph;
  const evidence = reasoning.findings.map((f) => ({
    ...f,
    sources: f.evidence.map((id) => reasoning.atoms.find((a) => a.id === id)?.noteId),
  }));
  await writeFile(
    new URL("live-findings.json", outputDir),
    JSON.stringify({ atoms: reasoning.atoms, findings: evidence }, null, 2),
  );
  const has = (f, ids) => ids.every((id) => f.sources.includes(id));
  const transfer = evidence.filter((f) => has(f, ["compute", "outing"]));
  const checks = {
    crossDomain: evidence.some(
      (f) => has(f, ["compute", "outing"]) && ["类比", "组合", "多跳"].includes(f.mode),
    ),
    conflict: evidence.some((f) => has(f, ["deadline1", "deadline2"]) && f.category === "矛盾"),
    combination: evidence.some(
      (f) => has(f, ["compute", "outing", "shuttle"]) && ["组合", "多跳"].includes(f.mode),
    ),
    noDecoy: evidence.every((f) => !f.sources.includes("decoy")),
    actionable: transfer.some(
      (f) =>
        /比较|对比|对照|回放|试验|测试/.test(f.check) &&
        /等待|换点|改道|改线|延误|时间/.test(f.check),
    ),
    boundary: transfer.some((f) =>
      /天气|数据|运营|核对|安全|避险|失效|代价|未验证|延误/.test(f.limitation),
    ),
    cache: (await generate()).reused === true,
  };
  console.log(
    JSON.stringify({ atomCount: reasoning.atoms.length, findingCount: edges.length, checks }),
  );
  if (!Object.values(checks).every(Boolean)) process.exitCode = 2;
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await driver.close();
  await rm(connector.projectPath, { recursive: true, force: true });
}
