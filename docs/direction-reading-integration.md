# Direction reading and discussion integration

The formal direction page already provides an editable outline and Markdown body, chapter discussion, rich discussion blocks, task decomposition, execution controls, and responsive reading layouts. The isolated redesign candidate was compared by behavior rather than file hashes. Two missing interactions have now been integrated into the formal components:

- The discussion panel can collapse on desktop. At an actual workspace width of 1000 px or less it becomes a modal drawer, while the document remains visible behind it. The drawer supports keyboard focus containment, Escape, backdrop dismissal and focus restoration. Opening details inside the drawer closes only the innermost dialog on Escape.
- The document selector shows the current draft or the latest confirmed document snapshot. It reads `IdeaPlan.draft` and `IdeaPlan.adopted.doc`; it does not create another document store. Confirmed snapshots expose no edit, confirm, revision or execution action. Returning to the draft restores the existing controls. Discussion history and document versions stay independent, and the discussion panel clearly targets the current draft.

The same affected components also preserve failed operations as actionable state: Agent changes cannot overlap and keep the saved Agent on failure; decomposition shows a busy state and a retryable error; attachment downloads show progress and offer retry. Attachment association failures retain existing attachments and remove only newly stored file bytes. All attachment operations share a synchronous lock.

The candidate's separate palette, broad outer-grid overrides and independent source tree were not copied. These are alternative implementations, not missing product capabilities. Existing formal styles, rich discussion, execution, runtime and Spec data paths remain the integration baseline. A candidate's completion alone must not be treated as integration or release evidence; formal source commits and the integrated application require their own checks.

## Verification

`tests/direction-reading.preview.html` mounts the production Workspace against an in-memory business source. It does not mount the application runtime controller, invoke a model or use the user's database. `tests/direction-reading.browser.mjs` verifies layout, focus, version isolation and failed-operation recovery, including rollback of browser attachment bytes. Supply `PLAYWRIGHT_MODULE`, `PREVIEW_URL` and `EVIDENCE_DIR` when running it in an environment with Playwright.

The integration passed 53 browser checks across 320, 390, 768, 1000, 1001, 1024, 1440 and 1920 px widths, plus a 900 px workspace inside a wide window. TypeScript, the repository test suite (including 281 Node subtests), and production build also passed. Native desktop E2E, PRD publication and release verification are separate integration responsibilities; this component check does not claim they are complete.

## Automation action follow-up

The direction header now renders the actual `deriveGoalAutomation` status. An enabled flag alone no longer means execution is progressing. An outdated authorization exposes an explicit restart for the current confirmed version; disabled automation exposes resume. Paused work links to the existing failed/waiting source session, prioritizing that source over its blocked dependents. Blocked work exposes the missing-condition route without repeating dispatch. Ready/running/assembled states show their own status. Existing version-bound business commands continue to own authorization and scheduling.

The added `tests/plan-actions.browser.mjs` passed 14 isolated checks across outdated, paused, blocked, disabled, ready and task-bound permission-waiting cases, including absence of repeated dispatch. This follow-up also passed TypeScript, production build and the repository tests.

## Read-only coverage audit

- Time dial: `ScheduleSummary` / `Spiral` project the saved calendar plans and runtime-backed execution intervals. `timeline` deduplicates events, excludes waiting/paused time, clips to the local day and unions overlapping actual time. Zero planned time means no explicit calendar allocation, not missing task estimates. Unplanned execution still contributes actual time. The dial is scoped to the current project; the daily sheet can combine projects.
- Compact input: `TaskInput` is collapsed by default, expands on click or file paste/drop, preserves the draft and collapses after save. `Composer` creates a task directly by default and keeps discussion as a separate action. File association is project-bound and idempotent, with 20 attachments / 25 MB per file limits. Upload support does not imply every file type has an inline preview.
- Goal and task trees: `Dashboard` / `OverviewTree` present project → task → subtask decomposition with connecting lines, dependencies, source-derived state and details. `OrchestrationBlock` / `TaskScope` expose nested task branches in the task workspace. The unused `TaskMap` component is not claimed as a delivered canvas. The formal design is a decomposition tree, not a fishbone or arbitrary dependency graph editor.
- Rich discussion: `PlanDiscussionBody`, discussion details and runtime messages render `DiscussionCanvas` photo/map/comparison/fact blocks. Validated blocks remain attached to the saved conclusion and collaboration evidence; per-block feedback is independent of direction approval. Agent responses need actual structured media evidence—plain text is not automatically decorated with invented imagery. Maps load on explicit interaction, with source links retained.

This read-only coverage audit found no additional immediate P1 gap in these four features. It does not replace native end-to-end validation or the separate direction/task-version consistency fix handled by the integration task.
