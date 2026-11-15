# Agent 连接与回源接口

前端 `gateway.ts` 是统一入口；`contracts.ts` 是 API v1 类型。“我的”页面或 Agent 名单的“配置 Agent”可检测本机工具、核对版本、填写项目目录、测试登录状态并显示实际验证的能力。工具和项目目录在用户点击保存后写入 localStorage，重启后保留。配对码和检测记录只保留在当前标签页的 sessionStorage。工具测试成功不会把示例日记变为真实项目。

## 本地启动

在源码目录运行 `node scripts/agent-bridge.mjs`（或 `npm run bridge`）。服务仅监听 `127.0.0.1:4175`。把终端的随机配对码填入界面，保持终端运行。

可通过 `QUANDECK_BRIDGE_PORT`、`QUANDECK_BRIDGE_ORIGINS` 配置端口和允许的精确前端 origin；默认仅允许 4173/4174/4176 的 localhost/127.0.0.1。`QUANDECK_BRIDGE_TOKEN` 可由宿主注入，不能提交到源码或前端环境变量。所有接口要求 Authorization Bearer；不读取认证文件、Cookie 或 API key，不返回账号内容。

## 接口

| 方法 | 路径 | 请求与响应 |
|---|---|---|
| GET | `/v1/tools` | `ToolDetection[]`，安装、版本、适配器状态；未测试不推断已登录 |
| POST | `/v1/connections/test` | `{ tool, projectPath }` → `ConnectionTest`；测试 Codex initialize/account/read，只返回登录状态 |
| POST | `/v1/discussions/open` | `{ connectionId, prompt }` → 打开已经测试的本地交互式 Agent。OpenCode 需要用户粘贴指令 |
| POST | `/v1/source/open` | `SourceOpenRequest` → `SourceOpenResult`；只有真实连接和经过 thread/read 校验的项目会话可打开 |
| POST | `/v1/interactions/respond` | `InteractionRequest` → `InteractionResult`；本地适配器返回 501，用户在源工具回复；预留给持有实时请求的后端 |

业务后端在 Session/Attempt 的 `source` 字段同步 `SourceReference`：connectionId/tool/sessionId/attemptId，以及 parentSessionId、childSessionId、childCallId、requestId。连接服务重启使 connectionId 失效，需要重新测试。禁止用子任务标题或示例 ID 拼接 URI。只有收到源端确认事件后才清除“待回复/待权限”；点回源按钮本身不改变状态。

## 当前能力边界

Codex 实现只读 App Server 连接与 macOS Terminal / Windows PowerShell 中 `codex resume UUID -C 项目目录`。恢复时不附带 prompt、不创建 turn。会话必须属于测试过的项目目录；如果独立子会话无法读取，校验父会话后打开父会话并明确提示，不声称自动滚动到子调用。`sourceUrl` 保留为后端契约，当前本地实现不信任或打开任意 URL。

Claude Code、Cursor、OpenCode 提供安装/版本检测以及交互式终端讨论入口。`discussionOpen` 独立表示可以打开本地工具，其登录状态由工具内流程确认。执行、用量、子 Agent 和权限回流能力按各自验证结果展示。WorkBuddy 与 DSH 提供官方安装说明，当前按手动协作使用。

协议依据为本机 Codex CLI 0.161.0 的 `app-server generate-json-schema`（initialize、account/read、thread/read）和 `codex resume --help`；官方接口入口：[Codex App Server](https://developers.openai.com/codex/app-server)。其他工具后端可按 [Claude Code](https://code.claude.com/docs/en/headless)、[Cursor ACP](https://cursor.com/docs/cli/acp)、[OpenCode API](https://opencode.ai/docs/api) 实现，并按版本复测后开放能力。

运行 `node --test scripts/agent-bridge.test.mjs` 验证协议路由、会话归属、子会话回退、命令参数引用、配对和 origin 限制。测试注入模拟源端，不打开用户真实会话或启动推理。


带实际页面截图的用户教程见 [本地 Agent 配置教程](../../docs/local-agent-setup.md)。桌面宿主通过 `window.quandeckDesktop.getConnection()` 供给本次配对、`chooseDirectory()` 选择目录，`platform` 选择对应操作系统教程。

### Configured Agent identity registration

Before persisting a local tool/project configuration, the UI calls the business source `registerAgent({id,name,short,color,makeDefault?})`. The HTTP source forwards this to `POST /v1/commands/registerAgent` using the standard `{args:[input],expectedRevision}` envelope and idempotency header; the response includes `{result:{ok,agentId},revision,snapshot}`. Registration is idempotent by Agent ID. It creates only an offline identity, preserves all sessions/tasks/statistics, and never dispatches or claims runtime capabilities.

The first registered tool becomes the default and updates only empty plans still assigned to the prior default. Plans containing conclusions retain their selected identity and immutable historical source IDs. The UI explicitly selects the configured discussion target before opening a handoff or record form. `recordDiscussionConclusion` accepts `agentId` as the explicit source captured by the form, validates that it is registered in the business snapshot, and does not infer it from a later target switch. Old local configuration is reconciled through the same registration command in the UI provider; the repository does not read connection preferences. Removing device configuration hides the tool from new selections but keeps business identity/history.
