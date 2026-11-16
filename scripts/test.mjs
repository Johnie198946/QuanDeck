import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const temporary = mkdtempSync(path.join(tmpdir(), "quandeck-domain-tests-"));
const run = (args) => execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
try {
  run([require.resolve("typescript/bin/tsc"), "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node",
    "--esModuleInterop", "--skipLibCheck", "--outDir", temporary,
    "tests/timeline.test.ts", "tests/timeline-repository.test.ts", "tests/http-repository.test.ts", "tests/results.test.ts", "tests/dashboard.test.ts", "tests/agent-registration.test.ts", "tests/task-map.test.ts", "tests/result-metrics.test.ts", "tests/projects.test.ts", "tests/portfolio.test.ts", "tests/manual-results.test.ts", "tests/http-projects.test.ts"]);
  for (const name of ["timeline", "timeline-repository", "http-repository", "results", "dashboard", "agent-registration", "task-map", "result-metrics", "projects", "portfolio", "manual-results", "http-projects"])
    run([path.join(temporary, "tests", `${name}.test.js`)]);
  run(["tests/search-summary.test.mjs"]);
  run(["--test", "scripts/gateway.test.mjs", "scripts/agent-bridge.test.mjs"]);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
