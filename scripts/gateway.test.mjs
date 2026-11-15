import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const dir = mkdtempSync(path.join(tmpdir(), "quandeck-gateway-test-"));
const require = createRequire(import.meta.url);
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "src/integration/gateway.ts", "--outDir", dir, "--module", "commonjs", "--target", "ES2020", "--lib", "ES2020,DOM", "--skipLibCheck"]);
const { createGateway, validateGatewayUrl } = require(path.join(dir, "gateway.js"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
const settings = () => ({ baseUrl: "http://127.0.0.1:4175", token: "pairing-test" });

test("sample source requests do not touch connector or pairing state", async () => {
  const gateway = createGateway(() => { throw new Error("must not inspect connection"); }, async () => { throw new Error("must not fetch"); });
  const result = await gateway.openSource({ mode: "sample", sessionId: "fixture" });
  assert.equal(result.status, "unavailable");
});
test("live missing source identity does not fabricate a successful jump", async () => {
  const gateway = createGateway(settings, async () => { throw new Error("must not fetch"); });
  assert.equal((await gateway.openSource({ mode: "live", sessionId: "s" })).status, "unavailable");
});
test("source exact identifiers survive HTTP boundary and return failures", async () => {
  let request;
  const gateway = createGateway(settings, async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ status: "parent_opened", message: "parent" }) }; });
  const input = { mode: "live", connectionId: "c", tool: "codex", sessionId: "s", attemptId: "a", parentSessionId: "p", childCallId: "call", requestId: "r" };
  const result = await gateway.openSource(input);
  assert.equal(result.status, "parent_opened");
  assert.deepEqual(JSON.parse(request.options.body), input);
  assert.equal(request.options.headers.Authorization, "Bearer pairing-test");
  assert.equal(request.url, "http://127.0.0.1:4175/v1/source/open");
  const broken = createGateway(settings, async () => ({ ok: false, status: 401, json: async () => ({ error: "配对失败" }) }));
  await assert.rejects(broken.detectTools(), /配对失败/);
});
test("gateway URL accepts localhost and HTTPS but rejects unsafe URLs", () => {
  assert.equal(validateGatewayUrl("http://localhost:4175"), "http://localhost:4175");
  assert.equal(validateGatewayUrl("https://gateway.example"), "https://gateway.example");
  for (const url of ["javascript:alert(1)", "http://gateway.example", "https://user:password@example.com", "https://example.com/path"]) assert.throws(() => validateGatewayUrl(url));
});
