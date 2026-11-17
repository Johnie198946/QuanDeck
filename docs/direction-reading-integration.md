# Direction reading and discussion integration

The formal direction page already provides an editable outline and Markdown body, chapter discussion, rich discussion blocks, task decomposition, execution controls, and responsive reading layouts. The isolated redesign candidate was compared by behavior rather than file hashes. Two missing interactions have now been integrated into the formal components:

- The discussion panel can collapse on desktop. At an actual workspace width of 1000 px or less it becomes a modal drawer, while the document remains visible behind it. The drawer supports keyboard focus containment, Escape, backdrop dismissal and focus restoration. Opening details inside the drawer closes only the innermost dialog on Escape.
- The document selector shows the current draft or the latest confirmed document snapshot. It reads `IdeaPlan.draft` and `IdeaPlan.adopted.doc`; it does not create another document store. Confirmed snapshots expose no edit, confirm, revision or execution action. Returning to the draft restores the existing controls. Discussion history and document versions stay independent, and the discussion panel clearly targets the current draft.

The same affected components also preserve failed operations as actionable state: Agent changes cannot overlap and keep the saved Agent on failure; decomposition shows a busy state and a retryable error; attachment downloads show progress and offer retry. Attachment association failures retain existing attachments and remove only newly stored file bytes. All attachment operations share a synchronous lock.

The candidate's separate palette, broad outer-grid overrides and independent source tree were not copied. These are alternative implementations, not missing product capabilities. Existing formal styles, rich discussion, execution, runtime and Spec data paths remain the integration baseline. A candidate's completion alone must not be treated as integration or release evidence; formal source commits and the integrated application require their own checks.

## Verification

`tests/direction-reading.preview.html` mounts the production Workspace against an in-memory business source. It does not mount the application runtime controller, invoke a model or use the user's database. `tests/direction-reading.browser.mjs` verifies layout, focus, version isolation and failed-operation recovery, including rollback of browser attachment bytes. Supply `PLAYWRIGHT_MODULE`, `PREVIEW_URL` and `EVIDENCE_DIR` when running it in an environment with Playwright.

The integration passed 53 browser checks across 320, 390, 768, 1000, 1001, 1024, 1440 and 1920 px widths, plus a 900 px workspace inside a wide window. TypeScript, the repository test suite (including 281 Node subtests), and production build also passed. Native desktop E2E, PRD publication and release verification are separate integration responsibilities; this component check does not claim they are complete.
