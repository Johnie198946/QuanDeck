import assert from "node:assert/strict";
import { createHttpDataSource } from "../src/data/httpRepository";
import { createSampleSnapshot } from "../src/data/fixtures";

const base = createSampleSnapshot();
let fetches: {url: string; init?: RequestInit}[] = [];
let revision = 1;
let fail = false;
const events: Record<string, (event?: unknown) => void> = {};
let closed = 0;
(globalThis as any).window = { dispatchEvent: () => {} };
(globalThis as any).EventSource = class {
  constructor(public url: string) {}
  addEventListener(name: string, callback: () => void) { events[name] = callback; }
  close() { closed++; }
};
globalThis.fetch = async (input, init) => {
  const url = String(input);
  fetches.push({url, init});
  if (fail) return new Response("error", {status: 503});
  return Response.json({ revision, snapshot: structuredClone(base), result: url.includes("addBlock") ? "saved-task-id" : {ok: true} });
};
(async () => {
  const source = createHttpDataSource("http://localhost:9000/");
  let observed = 0;
  const off = source.subscribe(() => { observed++; });
  assert.equal(source.mode, "live");
  assert.equal((await source.load()).project.id, base.project.id);
  assert.equal(observed, 1);
  assert.equal(fetches[0].url, "http://localhost:9000/v1/snapshot");
  assert.equal(fetches[0].init?.credentials, "include");
  revision = 2;
  assert.equal(await source.addBlock("task", "安排旅行"), "saved-task-id");
  const command = fetches.at(-1)!;
  assert.match(command.url, /commands\/addBlock$/);
  assert.deepEqual(JSON.parse(command.init?.body as string), {args: ["task", "安排旅行"], expectedRevision: 1, projectId: base.project.id});
  assert.ok((command.init?.headers as Record<string,string>)["Idempotency-Key"]);
  assert.equal(observed, 2);
  events.snapshot({data: JSON.stringify({revision: 1, snapshot: base})});
  assert.equal(observed, 2, "old snapshot ignored");
  events.snapshot({data: JSON.stringify({revision: 2, snapshot: base})});
  assert.equal(observed, 2, "duplicate snapshot ignored");
  events.snapshot({data: JSON.stringify({revision: 3, snapshot: base})});
  assert.equal(observed, 3);
  await assert.rejects(source.navigateToDate("invalid"));
  fail = true;
  await assert.rejects(source.completeTask("task-a"), /503/);
  assert.equal(observed, 3, "failed command preserves snapshot");
  off(); assert.equal(closed, 1);
  console.log("HTTP source: snapshot, commands, identity, idempotency header, replay order, failure preservation and stream cleanup passed.");
})().catch(error => {console.error(error);process.exitCode=1;});
