# 项目与人工成果 · v0.4.0

## 使用流程

首次打开只显示“新建项目”。创建后进入该项目的任务页；任务、方法、日程、执行和成果一起随项目切换。项目名称、简介和标识色可在项目菜单中修改。

任务默认由“我”完成，可拆成多级子任务。任务或子任务的“记录成果”提供标题、正文、链接和附件：

- 保存草稿：允许继续编辑，不计入已提交成果。
- 提交成果：加入成果页，不改变任务完成状态。
- 提交并完成：提交成果，同时完成所选任务或子任务。

每个成果明确显示来源。人工成果可编辑、删除、下载附件及导出 Markdown；Agent 完成回报来自已有执行记录，不通过人工编辑冒充 Agent 输出。

成果页按当前项目汇集内容，用来源占比、文字/链接/文件组成、任务覆盖率呈现实际数据。这里的自动归纳是对已提交内容与完成回报的组织统计，不生成没有依据的 AI 摘要。原有任务地图、方法和执行结果保持联动。

## 数据与隔离

`quandeck.projects.v1` 存储 `{schema:1, activeProjectId, projects, agents, defaultAgent}`。每个项目具有独立 Snapshot，任务、会话、方案、日程、成果与统计互不串写。Agent 配置共享，执行数据按项目区分。旧 `quandeck.demo.v3` 保留但不读取。

切换项目会清理旧项目选中态和弹层目标。异步命令绑定发起时的项目；后台执行事件按 `event.projectId` 路由。旧请求晚到不会覆盖新项目。

附件存储在 IndexedDB `quandeck-output-files/files`，键为 `projectId:attachmentId`。Snapshot 只保存文件名、类型、大小和 ID。单文件限制 25 MB。JSON 备份包含元数据，不包含文件字节；附件可在成果中单独下载。上传失败或保存失败会报告错误，不显示已提交。

## 业务后端接口

沿用 `WorkdeckDataSource` 和 `httpRepository.ts`，所有命令使用：

```json
{"args": [], "expectedRevision": 1, "projectId": "当前项目 ID"}
```

请求带 `Idempotency-Key`，响应为 `{result, revision, snapshot}`。后端验证项目权限和版本，不以客户端 projectId 代替授权。

| 操作 | 接口 / 参数 |
| --- | --- |
| 项目列表 | `GET /v1/projects` → `{projects: Snapshot[]}` |
| 新建项目 | `POST /v1/commands/createProject`，`args: [{name, description?, color?}]` |
| 切换项目 | `POST /v1/commands/switchProject`，`args: [projectId]` |
| 更新项目 | `POST /v1/commands/updateProject`，`args: [projectId, patch]` |
| 任务负责人 | `POST /v1/commands/setTaskOwner`，`args: [taskId, "me" 或 "agent"]` |
| 人工子任务 | `POST /v1/commands/addManualSubtask`，`args: [taskId, parentId, title]` |
| 保存成果 | `POST /v1/commands/saveTaskOutput`，`args: [{projectId, id?, taskId, workItemId?, title, body, links, attachments, status, complete}]` |
| 删除成果 | `POST /v1/commands/deleteTaskOutput`，`args: [outputId]` |

`status` 为 `draft` 或 `published`；`complete` 默认为 false。人工保存入口固定 `origin: human`，Agent 回报使用真实会话/执行记录。完成一个子任务不会自动完成所有父任务；新增子任务会重新打开已完成父任务。

当前附件保存在本机。若后端需要跨设备附件，必须另提供鉴权上传、下载、配额和删除接口，再替换 `outputFiles.ts`；不能仅凭附件元数据宣称已经上传云端。

## 验收

- 首次没有项目、任务或 Agent；不会读取演示库。
- 新建、修改、切换、刷新后项目独立且持久化。
- 草稿不计入已提交成果；人工任务在没有配置 Agent 时可完整使用。
- 人工正文、链接、附件保存后可检索目标任务、查看、下载和编辑。
- 项目总览统计主任务，子任务进度另算；手动与 Agent 成果按真实来源聚合。
- 桌面安装测试使用独立空 userData，必须通过 `cleanStartup` 后才允许发布 v0.4.0 安装包。


## 删除项目与任务

项目卡片、项目切换列表、任务卡片和子任务树在悬停或键盘聚焦时显示删除按钮；触屏始终可见。确认框明确说明保留范围。

- 删除项目后，项目退出工作台、搜索和日程；当前项目删除后自动选择剩余项目，最后一个项目删除后回到空工作区。
- 删除主任务连同子任务退出活动任务列表；删除子任务同时移除其后代，保留其他分支。相关未开始日程取消，已有投入记录保留。
- 删除是从活动工作区移除：项目 `deletedAt`、任务 `deletedTasks` 与子任务 `deletedWorkItems` 保留本地历史。已发布来源、执行记录和附件不会被物理清除，也不会删除外部 Agent 会话。已归档来源依赖会提示重新核对。当前没有回收站恢复入口。
- 仍在执行、待答、待授权、未归档的暂停会话或人工计时会阻止删除。项目后台分析尚未结束时也需等待；工作台不会把“删除”当作停止源进程的回执。
- 删除命令固定点击时的项目和任务身份，写入失败会回滚；已删除身份拒绝晚到执行更新或重新写入。
- IPC/HTTP 同步提供 `deleteProject(projectId)` 与 `deleteTask(taskId, projectId, workItemId?)`。HTTP 业务后端需实现同等事务与历史保护合同。
