# Discussion and information confirmation

QuanDeck renders public Agent replies as Markdown. The optional `<quandeck-conclusion>` envelope separates the round summary, proposed facts (`confirmed`, a legacy field name), and questions (`open`). Proposals are never preselected or treated as user consent. The user can edit selected facts, answer any questions, add their own information, and explicitly send the combined reply. Unsent text and confirmation drafts are stored per run/message on this device. Failed sends preserve inputs. Older exchanges and raw protocol messages are available in collapsed details.

Optional response collections:

- `cards: [{ title, body }]` for short Markdown cards.
- `charts: [{ title, type: "bar" | "line", labels: string[], series: [{ label, values: number[] }] }]` for finite, aligned source data, including a readable data table.
- `attachments: [{ name, path }]` for files inside the associated project directory.

Follow-up discussion turns reassert concise response instructions, including for restored older conversations. The runtime records the user's original input separately from these formatting instructions. QuanDeck does not impose Token budgets; actual usage remains recorded and source Agent quota errors remain visible.

Local previews support PNG/JPEG/GIF/WebP, MP4/WebM/MOV (subject to system codecs), PDF, DOCX, XLSX, CSV and text. PDF fonts/maps/decoders are bundled; Word and Excel are parsed locally without macros, formulas or remote Office services. DOCX previews show text, headings and tables; XLSX previews show saved cell values and sheet selection. Complex Office layout, images, number formats and charts require the original file. `.doc` and `.xls` are not previewed. Resource limits are file safety/display limits, not model usage limits. File-folder navigation remains available even when decoding/size prevents preview.

Opening an existing managed session from a task enters the QuanDeck discussion window; its dedicated native-source action opens the original Agent. Unmanaged sources keep their validated source-tool route.

The runtime's native-source action sends `destination: "native"` to the authenticated gateway. Codex uses a validated real thread UUID and the installed app's deep link, with verified CLI resume as fallback. Claude uses its resume command. DSH/Hermes versions without a verified exact-session entry return an explicit unsupported result rather than reopening the QuanDeck window.

Validation: `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm build`; optional renderer check with `QUANDECK_PLAYWRIGHT_MODULE=<installed module> QUANDECK_UI_URL=<dev server> node tests/runtime-ui.browser.mjs`. All renderer fixtures are isolated and do not call a live model.
