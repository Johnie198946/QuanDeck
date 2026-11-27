import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "./app/node_modules/fflate/esm/index.mjs";
import { createKnowledgeFileReader } from "./app/knowledge-attachment-text.mjs";
import { createKnowledgeGraphGenerator } from "./app/knowledge-graph-agent.mjs";

const digest = (text) => createHash("sha256").update(text).digest("hex");
const buffer = (data) => (Buffer.isBuffer(data) ? data : Buffer.from(data));
const meta = (id, bytes) => ({
  id,
  name: id,
  size: buffer(bytes).length,
  sha256: digest(buffer(bytes)),
});
const word = Buffer.from(
  zipSync({
    "word/document.xml": strToU8(
      '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>备用站点可减少排队</w:t></w:r></w:p></w:body></w:document>',
    ),
  }),
);
test("Office and text source ranges, explicit partial and unsupported coverage, no permanent copy of file contents", async () => {
  const data = new Map([
    ["rules.docx", word],
    ["路线.txt", "延误时换路线"],
    ["image.png", "image"],
  ]);
  const note = {
    id: "n",
    title: "材料",
    body: "",
    revision: 1,
    attachments: [...data].map(([id, bytes]) => meta(id, bytes)),
  };
  let reads = 0;
  const reader = createKnowledgeFileReader({
    platform: "win32",
    readBytes: async (id) => {
      reads++;
      return buffer(data.get(id));
    },
  });
  const result = await reader.prepare([note]);
  assert.deepEqual(
    result.coverage.map((f) => f.status),
    ["partial", "read", "unsupported"],
  );
  assert.equal(reads, 2);
  assert.equal(result.notes[0].attachmentSources[0][1], "备用站点可减少排队");
  assert.equal(result.notes[0].attachmentSources[1][1], "延误时换路线");
  assert.equal(note.attachmentSources, undefined);
  assert.doesNotMatch(JSON.stringify(result.coverage), /延误时换路线|备用站点/);
  await reader.prepare([note]);
  assert.equal(reads, 2);
  const source = "attachment:路线.txt",
    anchor = { noteId: note.id, revision: 1, source, start: 0, end: 3, digest: digest("延误时") };
  const library = { notes: [note], agentGraph: { edges: [{ anchors: [anchor] }] } };
  assert.equal(await reader.quote(library, anchor), "延误时");
  await assert.rejects(reader.quote(library, { ...anchor, end: 4 }), /变化/);
  const mismatched = { ...note.attachments[1], sha256: "0".repeat(64) };
  assert.equal(
    (await reader.prepare([{ ...note, attachments: [mismatched] }])).coverage[0].status,
    "failed",
  );
});
test("graph derives an evidenced cross-note finding from a file, resolves original bytes and evicts findings after removal", async () => {
  const raw = "本季确认预算 780 元。\n核对账号请看页尾。";
  const file = meta("预算.txt", raw);
  const library = {
    notes: [
      { id: "a", title: "差旅", body: "当预算超过 700 元要复核。", revision: 1 },
      { id: "b", title: "报销", body: "", revision: 1, attachments: [file] },
    ],
    decisions: [],
  };
  const reader = createKnowledgeFileReader({ readBytes: async () => buffer(raw) });
  const profile = { connectionId: "test", tool: "codex" };
  let rounds = 0;
  const generate = createKnowledgeGraphGenerator({
    readLibrary: () => library,
    saveGraph: (_, g) => (library.agentGraph = g),
    readConfigured: () => [profile],
    connections: () => [profile],
    prepareAttachments: reader.prepare,
    assist: async (req) => {
      const rows = JSON.parse(req.prompt.split("\n").at(-1));
      rounds++;
      const output = req.outputSchema.properties.atoms
        ? {
            atoms: rows
              .filter((r) => r.source !== "title")
              .map((r) => ({
                part: r.part,
                quote: r.text.split("\n")[0],
                summary: r.file ? "预算已确认" : "预算上限需要复核",
                kind: "约束",
                domain: "预算",
                mechanism: "复核",
                goal: "核对预算",
                constraint: "",
                entities: [],
                features: [0, 0, 0, 2, 0, 3, 0, 0, 0, 0, 0, 0],
              })),
          }
        : {
            findings: [
              {
                evidence: rows.map((r) => r.id),
                category: "补充",
                mode: "直接",
                label: "预算需要复核",
                explanation: "最新预算超过已设阈值。",
                consequence: "这笔费用需要负责人复核。",
                check: "检查该项费用是否已经登记复核。",
                limitation: "仅适用于本季差旅。",
              },
            ],
          };
      return {
        ...req,
        sourceSessionId: "s",
        contextPolicy: "new-isolated-session",
        toolPolicy: "read-only-isolated",
        output,
      };
    },
  });
  await generate();
  const anchor = library.agentGraph.edges[0].anchors.find((a) =>
    a.source.startsWith("attachment:"),
  );
  assert.equal(anchor.origin, "附件资料");
  assert.equal(await reader.quote(library, anchor), "本季确认预算 780 元。");
  assert.doesNotMatch(JSON.stringify(library.agentGraph), /核对账号请看页尾/);
  const prev = rounds;
  await generate();
  assert.equal(prev, rounds);
  library.notes[1].attachments = [];
  library.notes[1].revision++;
  await generate();
  assert.equal(library.agentGraph.edges.length, 0);
  assert.ok(library.agentGraph.reasoning.history.length);
  await assert.rejects(reader.quote(library, anchor));
});

test("user question, optional background, AI answer and external citation retain authorship and original time", async () => {
  const { extractKnowledgeAtoms } = await import("./app/knowledge-reasoning.mjs");
  const note = {
    id: "n",
    title: "",
    body: "",
    revision: 7,
    updatedAt: "2026-10-30T08:00:00Z",
    expansions: [
      {
        id: "q",
        at: "2026-10-01T01:02:03Z",
        selection: { quote: "车次" },
        question: "换乘窗口多长才合适？",
        background: "我携带行李。",
        answer: "建议预留时间。",
        sources: [{ excerpt: "换乘需要步行。", checkedAt: "2026-09-28T06:00:00Z" }],
      },
    ],
  };
  const { atoms } = await extractKnowledgeAtoms({
    notes: [note],
    ask: async (prompt) => {
      const materials = JSON.parse(prompt.split("\n").at(-1));
      assert.match(materials.find((m) => m.source === "question:q").context, /车次/);
      return {
        atoms: materials.map((m) => ({
          part: m.part,
          quote: m.text,
          summary: "换乘说明",
          domain: "出行",
          mechanism: "",
          goal: "",
          constraint: "",
          kind: "观点",
          entities: [],
          features: Array(12).fill(0),
        })),
      };
    },
  });
  assert.deepEqual(
    atoms.map((a) => [a.source, a.origin, a.at]),
    [
      ["question:q", "用户提问", note.expansions[0].at],
      ["background:q", "用户补充背景", note.expansions[0].at],
      ["expansion:q", "AI推断", note.expansions[0].at],
      ["citation:q:0", "引用资料", note.expansions[0].sources[0].checkedAt],
    ],
  );
});

test("deleted files evict cached quotes and late reads cannot repopulate them", async () => {
  let complete;
  const file = meta("draft.txt", "private");
  const cached = meta("old.txt", "private");
  const calls = [];
  const reader = createKnowledgeFileReader({
    readBytes: async (id) => {
      calls.push(id);
      if (id === file.id && calls.filter((n) => n === id).length === 1)
        return new Promise((resolve) => {
          complete = resolve;
        });
      return buffer("private");
    },
  });
  const batch = (attachments) => reader.prepare([{ id: "n", attachments }]);
  await batch([cached]);
  const pending = batch([file, cached]);
  reader.forget(file.id);
  reader.forget(cached.id);
  complete(buffer("private"));
  assert.deepEqual((await pending).coverage, []);
  // No stale cached values, even from the cancelled pending read.
  await batch([file, cached]);
  assert.deepEqual(calls, [cached.id, file.id, file.id, cached.id]);
});
