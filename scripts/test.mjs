import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
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
    "tests/plan-actions.test.ts", "tests/runtime-presentation.test.ts", "tests/project-workflow.test.ts", "tests/execution-progress.test.ts", "tests/discussion-presentation.test.ts", "tests/result-presentation.test.ts", "tests/governance.test.ts", "tests/management-integration.test.ts", "tests/context-acceptance.test.ts", "tests/usage-accounting.test.ts", "tests/projection-import.test.ts", "tests/runtime-binding.test.ts", "tests/deletion.test.ts", "tests/result-integration.test.ts", "tests/integration-review.test.ts", "tests/task-memory.test.ts", "tests/intelligence.test.ts", "tests/intelligence-runtime.test.ts", "tests/collaboration.test.ts", "tests/runtime-collaboration.test.ts", "tests/task-identity.test.ts", "tests/now-logs.test.ts", "tests/purpose-metrics.test.ts", "tests/runtime-data.test.ts", "tests/daily-schedule.test.ts", "tests/timeline.test.ts", "tests/timeline-repository.test.ts", "tests/http-repository.test.ts", "tests/results.test.ts", "tests/dashboard.test.ts", "tests/agent-registration.test.ts", "tests/task-map.test.ts", "tests/result-metrics.test.ts", "tests/projects.test.ts", "tests/task-attachments.test.ts", "tests/task-input.test.ts", "tests/task-input-races.test.ts", "tests/portfolio.test.ts", "tests/manual-results.test.ts", "tests/http-projects.test.ts"]);
  for (const name of ["plan-actions", "runtime-presentation", "project-workflow", "execution-progress", "discussion-presentation", "result-presentation", "governance", "management-integration", "context-acceptance", "usage-accounting", "projection-import", "runtime-binding", "deletion", "result-integration", "integration-review", "task-memory", "intelligence", "intelligence-runtime", "collaboration", "runtime-collaboration", "task-identity", "now-logs", "purpose-metrics", "runtime-data", "daily-schedule", "timeline", "timeline-repository", "http-repository", "results", "dashboard", "agent-registration", "task-map", "result-metrics", "projects", "task-attachments", "task-input", "task-input-races", "portfolio", "manual-results", "http-projects"])
    run([path.join(temporary, "tests", `${name}.test.js`)]);
  run(["tests/search-summary.test.mjs"]);
  run(["--test", ...readdirSync(path.join(root, 'scripts/runtime')).filter(name => name.endsWith('.test.mjs')).map(name => `scripts/runtime/${name}`), "scripts/agent-configuration.test.mjs", "desktop/quit-lifecycle.test.mjs", "desktop/run-workflow.test.mjs", "desktop/local-store.test.mjs", "desktop/storage-maintenance.test.mjs", "desktop/task-attachments.test.mjs", "desktop/attachment-preview.test.mjs", "scripts/gateway.test.mjs", "scripts/agent-bridge.test.mjs"]);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
