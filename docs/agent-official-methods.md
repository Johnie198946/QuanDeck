# Local Agent connection methods

Verified on 2026-11-16 against official documentation and local Codex CLI help. Commands are instructions for the user; the application must not automatically install tools or change credentials.

| Tool | macOS | Windows | Login / check | Interactive discussion |
| --- | --- | --- | --- | --- |
| Codex | Official native installer or official npm package | Official native Windows CLI; check current Windows sandbox prerequisites | `codex login`; `codex --version` | `codex --cd <project> <prompt>` |
| Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash`; macOS 13+ | PowerShell: `irm https://claude.ai/install.ps1 \| iex`; Windows 10 1809+ / Server 2019+ | `claude auth login`; `claude --version`; `claude doctor` | Run `claude <prompt>` with project as working directory |
| Cursor Agent | `curl https://cursor.com/install -fsS \| bash` | PowerShell: `irm 'https://cursor.com/install?win32=true' \| iex` | `agent login`; `agent --version` | Run `agent <prompt>` with project as working directory |
| OpenCode V2 | `curl -fsSL https://opencode.ai/v2/install \| bash`; npm package is now `@opencode/cli` | Download the standalone Windows CLI from the official site; V2 docs say package managers are not supported on Windows | `/connect` inside TUI; `opencode service status` | `opencode <project>`; user pastes discussion prompt in TUI |
| WorkBuddy | Official DMG, macOS 12+, move to Applications | Official Windows installer, x64 / compatible ARM64 | Sign in from the app via browser | Mac: detect and open the installed app; task APIs require developer registration and authorization |
| DSH / DeepSeek Harness | Node-based CLI; follow current project prerequisites | Node-based CLI; native packaging/OS support must be checked against the current release | `npx @deepseek-ai/dsh --help` | `npx @deepseek-ai/dsh web` starts local web interface, default port 3080 |

## Adapter boundaries

- **Codex**: local `codex` CLI, version `0.161.0`, confirmed `codex [OPTIONS] [PROMPT]`, `--cd`, and `app-server` stdio options. App Server is the structured integration boundary. Do not present an ordinary terminal launch as an already indexed session.
- **Claude Code**: `claude <prompt>` is interactive; `claude -p <prompt>` exits after a response and is inappropriate for a live discussion terminal. Native Windows no longer requires Git Bash: current setup docs also support PowerShell. Native Windows sandbox support remains different from WSL2.
- **Cursor**: native Windows installation is now documented. `agent acp` exposes a stdio JSON-RPC transport. Verify session, permission and resume features before advertising them in a connector.
- **OpenCode**: V2 differs materially from V1. `opencode run <prompt>` is noninteractive. `opencode pair` creates a temporary local pairing link; `opencode service status` reports the actual local URL. Current service authentication uses HTTP Basic with username `opencode` and generated / `OPENCODE_PASSWORD` password. Never hardcode the old V1 authentication variable or assume an unauthenticated server.
- **WorkBuddy**: do not substitute CodeBuddy CLI for WorkBuddy. QuanDeck detects and opens the macOS desktop app. The [official Open API](https://open.workbuddy.cn/docs/openapi) requires a registered application and OAuth authorization. The [official new-task deep link](https://open.workbuddy.cn/docs/third-party-app) requires a registered signing key. Neither is configured by installing the app alone.
- **DSH**: official repository is `deepseek-ai/deepseek-harness`, currently described as developer preview. The CLI documents web, ACP and headless profiles; expose capabilities only after validating the installed version.

## Official sources

- Codex CLI: https://developers.openai.com/codex/cli (redirects to https://learn.chatgpt.com/docs/codex/cli)
- Codex App Server: https://developers.openai.com/codex/app-server
- Codex Windows: https://developers.openai.com/codex/windows
- Claude installation: https://code.claude.com/docs/en/setup
- Claude CLI reference: https://code.claude.com/docs/en/cli-reference
- Claude hooks: https://code.claude.com/docs/en/hooks
- Cursor installation: https://cursor.com/docs/cli/installation
- Cursor CLI overview: https://cursor.com/docs/cli/overview
- Cursor ACP: https://cursor.com/docs/cli/acp
- OpenCode V2 installation: https://opencode.ai/docs
- OpenCode CLI: https://opencode.ai/docs/cli/
- OpenCode commands: https://opencode.ai/docs/cli/commands/
- OpenCode service and pairing: https://opencode.ai/docs/cli/web/
- WorkBuddy macOS: https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Installation-Mac-Guide
- WorkBuddy Windows: https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Installation-Win-Guide
- DeepSeek Harness: https://github.com/deepseek-ai/deepseek-harness
- DSH CLI help: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cli-help.md

Installation URLs and commands can change. Tutorial screenshots must show the actual official page or an actual local application; generated screenshots are not evidence of successful connection.

## Discussion and task-method workflow

1. The user enters an idea and chooses **交给 Agent 讨论**, or opens **先分析** on an existing task. QuanDeck keeps one root task and prepares a brief with the goal, constraints, scope and expected outputs.
2. A source handoff is a separate action. A tested local connection can open the selected tool in its project; a copied brief has not been sent. Viewing a brief or selecting an Agent must not start inference or create an execution record.
3. **记录 Agent 结论** is a manual record. It preserves the declared source Agent, optional source URL, confirmed decisions and open questions. It is not evidence of an automatic source reply. Contradictory confirmed/open statements are rejected without losing form input.
4. **采用到方案** is a second explicit transaction, after recording. It updates the method draft without dispatching work. Draft revision numbers and adopted method versions are separate identities and must not be compared as interchangeable counters.
5. **整理为任务** opens an editable preview. Ownership may be human, Agent or unassigned. Confirming the preview creates children under the same root, snapshots the adopted method and records each child's source clauses/version; it does not launch any Agent.
6. The results board displays that adopted method. Child selection shows its associated clauses; actual results appear only after a real completed report or a separately recorded result. An empty result is not a failed plan.

Browser verification records live in the task's `output/validation/analysis-flow.json`; PNGs are actual captures of the running application. They use explicitly labelled test conclusions and do not represent a real travel booking or a real Agent discussion.

The final browser run passed 10 checks: an initially empty roster; real Codex metadata/login verification and registration; one selectable configured tool; a centered handoff dialog; contradictory input rejection with preserved text; explicit method adoption; one root with three children (two human-owned); adopted-method/conclusion consistency; duplicate-proof task generation; and a readable 744px method view. It sent **zero** `/v1/discussions/open` requests and created **zero** execution attempts. The verified local connector reported discussion/source/resume capabilities separately from still-unconnected execution, dispatch, token, sub-Agent and permission-event synchronization.
