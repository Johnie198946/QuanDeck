# Completion manifest

- task_id: quandeck-preview-stability-20261117
- status: COMMITTED
- branch: codex/quandeck-preview-stability-20261117
- worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-preview-stability-20261117
- local_commit: 5417b03ac6e000b50e8900daaf37f78e1c0818be
- objective: Keep an open Markdown attachment reader mounted during background snapshot updates, while resetting it when the file or source run actually changes.

## Starting inventory

- `git status --short --branch`: clean own branch, `## codex/quandeck-preview-stability-20261117`.
- `git branch --show-current`: `codex/quandeck-preview-stability-20261117`.
- `git rev-parse HEAD`: `8ce473b6abcbbc89b0ee4949a75ee5845752749f`.
- `git remote -v`: origin fetch/push `https://github.com/Johnie198946/QuanDeck.git`.
- `git worktree list --porcelain`: inspected; independent worktree, complete local inventory `/private/tmp/quandeck-preview-stability-own-worktrees.txt`.
- Root integration worktree contained an unrelated modified `docs/permissions-spec-flow-audit.md`. It was not changed or staged here.

## Files and cause

- `src/components/runtime/RichMessage.tsx`: ReactMarkdown renderer functions were previously recreated each render, making React remount paragraphs and file links. Memoize the component mapping by source run and key media by source run/path.
- `tests/markdown-stability.preview.html`, `tests/markdown-stability.preview.tsx`, `tests/markdown-stability.browser.mjs`: isolated production renderer fixture and browser regression.
- `docs/attachment-reading-stability.md`: product requirement and behavior.
- No change to attachment service, access scope, source runtime, user database or HTML sandbox.

## Validation

- Targeted Chromium check passed: 13 background snapshots preserve dialog and iframe DOM, iframe document state, reading scroll position and single file read. Actual file/run changes reset the reader.
- 1440 and 390 widths pass; dialog has no horizontal overflow; Escape closes and restores trigger focus; no page errors.
- Screenshots visually inspected: `/private/tmp/quandeck-preview-stability-20261117/preview-stable-1440.png` and `preview-stable-390.png`; machine evidence `checks.json` in the same directory.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed, existing chunk-size warning only; `/private/tmp/quandeck-preview-stability-build.log`.
- `git diff --check`: passed.
- Full suite intentionally not repeated for this focused change per parent instruction. Parent owns final integrated native verification and release. No real model calls or actual app manipulation were performed.

## Delivery and recovery

- remote/ref/SHA: Not pushed by this child task; parent integrates and releases. No remote SHA claim.
- server_before: Not applicable, no deployment.
- server_after: Not applicable, no deployment.
- health_check: TypeScript and build passed; no production health claim.
- functional_check: Isolated Chromium regression passed, production RichMessage and attachment reader components mounted.
- rollback_point: `8ce473b6abcbbc89b0ee4949a75ee5845752749f`; revert implementation commit if needed.
- remaining_risks: A real navigation that unmounts the whole message intentionally closes its reader. Parent must verify the final native app polling path.
