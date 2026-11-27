import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createInspirationExtractor } from "./app/inspiration-extractor.mjs";
import { knowledgeAttachment } from "./app/attachment-preview.mjs";

const profile = { connectionId: "fixture", tool: "codex" };
const digest = (text) => createHash("sha256").update(text).digest("hex");
const sentence = "一个入口连多个模型，拥堵时换空闲模型。";
const examples = [
  {
    id: "one",
    title: "发布清单",
    revision: 2,
    body: "重点如下。" + sentence + "当天不对外开放。",
    expansions: [{ answer: "AI独有回答" }],
  },
  { id: "two", title: "差旅草稿", revision: 1, body: "延误时改走备用路线。" },
  { id: "three", title: "无关草稿", revision: 1, body: "盆栽" },
];
function fixture(alter) {
  const library = { notes: structuredClone(examples) },
    calls = [],
    configured = [{ ...profile }];
  const extract = createInspirationExtractor({
    readLibrary: () => library,
    readConfigured: () => configured,
    connections: () => configured,
    assist: async (request) => {
      calls.push(request);
      const materials = JSON.parse(request.prompt.split("\n").at(-1));
      const ideas = materials.flatMap(({ text, part }) => {
        const card = (title, detail, quote) => ({ part, title, detail, quote });
        if (text.includes(sentence))
          return [
            card("统一接入", "多个模型共用一个入口。", sentence),
            card("智能路由", "忙时换到空闲模型。", sentence),
            card("开放限制", "当天只供内部使用。", "当天不对外开放。"),
          ];
        if (text.includes("备用路线")) return [card("备用路线", "晚点时换条路走。", "备用路线")];
        return [];
      });
      const reply = {
        ...request,
        sourceSessionId: "session",
        toolPolicy: "read-only-isolated",
        contextPolicy: "new-isolated-session",
        output: { ideas },
      };
      return alter ? alter(reply, library, configured) : reply;
    },
  });
  return { extract, calls, library, configured };
}

test("one short ELI5 card per point, including separate points in one quote, traced to the exact source", async () => {
  const { extract, calls, library } = fixture();
  const [cards, again] = await Promise.all([extract(["one"]), extract(["one", "one"])]);
  assert.deepEqual(cards, again);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, "inspiration-extraction");
  assert.deepEqual(
    cards.map((c) => c.idea.title),
    ["统一接入", "智能路由", "开放限制"],
  );
  assert.deepEqual(
    cards.map((c) => c.idea.detail),
    ["多个模型共用一个入口。", "忙时换到空闲模型。", "当天只供内部使用。"],
  );
  assert.equal(new Set(cards.map((c) => c.id)).size, 3);
  const materials = JSON.parse(calls[0].prompt.split("\n").at(-1));
  assert.equal(materials.length, 1);
  assert.doesNotMatch(calls[0].prompt, /差旅草稿|无关草稿|AI独有回答/);
  assert.doesNotMatch(JSON.stringify(calls[0].outputSchema), /features|entities|domain|mechanism/);
  for (const c of cards) {
    assert.ok([...c.idea.title].length <= 12 && [...c.idea.detail].length <= 20);
    const { start, end, revision, field, digest: hash } = c.idea.source;
    assert.equal(revision, 2);
    assert.equal(field, "body");
    assert.equal(digest(library.notes[0][field].slice(start, end)), hash);
  }
});

test("caches empty and useful selections across combinations, but refreshes changed content, profile and removed notes", async () => {
  const { extract, calls, library, configured } = fixture();
  const [first, subset] = await Promise.all([extract(["one", "two"]), extract(["two"])]);
  assert.deepEqual(
    first.filter((c) => c.idea.source.noteId === "two"),
    subset,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(await extract(["three"]), []);
  await extract(["one", "three"]);
  assert.equal(calls.length, 2);
  library.notes[0].body += "新补充";
  await extract(["one", "two"]);
  assert.equal(calls.length, 3);
  assert.doesNotMatch(calls[2].prompt, /差旅草稿/);
  configured[0].model = "changed";
  await extract(["one"]);
  assert.equal(calls.length, 4);
  extract.forgetNote("one");
  await extract(["one"]);
  assert.equal(calls.length, 5);
  library.notes[0].archivedAt = "2026-01-01";
  await assert.rejects(extract(["one"]), /移除/);
  await assert.rejects(extract(["missing"]), /移除/);
});

test("stale notes or connections, ambiguous/fabricated quotes, verbose or missing copy and invalid receipts cannot become cards", async () => {
  for (const invalidate of [
    (r, lib) => {
      lib.notes[0].revision++;
    },
    (r, lib) => {
      lib.notes[0].body += "new";
    },
    (r, lib) => {
      lib.notes[0].archivedAt = "today";
    },
    (r, lib, cfg) => {
      cfg[0].model = "other";
    },
    (r) => {
      r.requestId = "wrong";
    },
    (r) => {
      r.output.ideas[0].quote = "invented";
    },
    (r) => {
      r.output.ideas[0].quote = "。";
    },
    (r) => {
      r.output.ideas[0].part = "p1";
    },
    (r) => {
      r.output.ideas[0].detail = "";
    },
    (r) => {
      r.output.ideas[0].detail = "说".repeat(21);
    },
    (r) => {
      r.output.ideas[0].title = "统一接入是拟用实践材料支撑的重点功能之一。";
    },
  ]) {
    const { extract } = fixture((r, l, c) => {
      invalidate(r, l, c);
      return r;
    });
    await assert.rejects(extract(["one"]));
  }
});

test("based on the saved source, old verbose cards remain placed without merging other ideas in the same sentence", async () => {
  const { extract, library } = fixture((r) => {
    r.output.ideas.push({ ...r.output.ideas[0] });
    return r;
  });
  const fresh = await extract(["one"]);
  library.inspirationCanvas = {
    nodes: [
      {
        noteId: "legacy-id",
        idea: {
          title: "统一接入是拟用实践材料支撑的重点功能之一。",
          detail: "",
          origin: "extracted",
          source: { ...fresh[0].idea.source },
        },
      },
    ],
  };
  const next = await extract(["one"]);
  assert.deepEqual(
    next.map((c) => c.id),
    ["legacy-id", fresh[1].id, fresh[2].id],
  );
});

test("all parts of a long note are read with correct offsets, and a substantive title alone can carry an idea", async () => {
  const { extract, library } = fixture();
  library.notes[0].body = "字".repeat(19000) + library.notes[0].body;
  library.notes[2].title = "延期就改走备用路线";
  library.notes[2].body = "";
  const rows = await extract(["one", "three"]);
  assert.ok(rows.find((card) => card.idea.title === "统一接入").idea.source.start >= 19000);
  const last = rows.find((card) => card.idea.source.noteId === "three").idea.source;
  assert.equal(last.field, "title");
  assert.equal(library.notes[2].title.slice(last.start, last.end), "备用路线");
});

test("the six-card limit is applied after comparing the ending of a long note with its earlier points", async () => {
  const body = "先做六件事。" + "甲".repeat(17000) + "最终决定取消展览。";
  const note = { id: "long", title: "布展", body, revision: 1 };
  let ranks = 0;
  const extract = createInspirationExtractor({
    readLibrary: () => ({ notes: [note] }),
    readConfigured: () => [profile],
    connections: () => [profile],
    assist: async (req) => {
      const materials = JSON.parse(req.prompt.split("\n").at(-1));
      const output = {};
      if (req.outputSchema.properties.ideas) {
        output.ideas = materials.flatMap(({ part, text }) =>
          text.includes("先做六件事")
            ? Array.from({ length: 6 }, (_, i) => ({
                part,
                title: "安排" + i,
                detail: "先核对表格第" + i + "项。",
                quote: "先做六件事。",
              }))
            : [
                {
                  part,
                  title: "取消展览",
                  detail: "这场展览取消。",
                  quote: "最终决定取消展览。",
                },
              ],
        );
      } else {
        ranks++;
        assert.equal(materials.length, 7);
        const tail = materials.find((c) => c.title === "取消展览");
        assert.ok(tail);
        output.selected = [tail.id];
      }
      return {
        ...req,
        sourceSessionId: "s",
        toolPolicy: "read-only-isolated",
        contextPolicy: "new-isolated-session",
        output,
      };
    },
  });
  const rows = await extract(["long"]);
  assert.equal(ranks, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].idea.title, "取消展览");
  assert.equal(rows[0].idea.source.start, body.indexOf("最终决定"));
});

test("discard an in-flight extraction forgotten before the model returns", async () => {
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const { extract } = fixture(async (receipt) => {
    await wait;
    return receipt;
  });
  const first = extract(["one"]);
  extract.forgetNote("one");
  release();
  await assert.rejects(first, /变化/);
  assert.equal((await extract(["one"])).length, 3);
});

test("reference files are resolved by their canvas owner exactly like existing note attachments", () => {
  const file = { id: "photo", name: "map.png", type: "image/png", size: 32 };
  const lib = {
    notes: [{ id: "other", attachments: [] }],
    inspirationCanvas: { nodes: [{ noteId: "ref", idea: { reference: { file } } }] },
  };
  assert.equal(knowledgeAttachment(lib, "ref", "photo"), file);
  assert.equal(knowledgeAttachment(lib, "other", "photo"), undefined);
  assert.equal(knowledgeAttachment(lib, undefined, "photo"), file);
});
