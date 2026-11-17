# 授权范围与执行层边界

## 实际根因

QuanDeck 0.11.1 的执行适配器已经接收到源 Agent 的权限请求，但前端和回传校验只保留“允许本次 / 拒绝”。本地 Codex CLI 0.161.0 的实际生成协议包含 `acceptForSession`、命令规则和网络规则，这些能力没有被呈现。

新叶任务通常使用新的源会话。即使原会话记住授权，也不能宣称它自动覆盖新任务。QuanDeck 当前在 Codex `thread/start`、`thread/resume`、`turn/start` 显式使用按需审批，线程使用工作区写入沙箱；这可能与用户在 Codex 原界面中的有效配置不同。共用登录不等于共用源会话和权限偏好。

“是否满意方向”“缺少哪个输入”“是否允许工具操作”是三类不同事件。业务讨论不能代替工具权限，工具授权不能成为成果验收。操作系统的系统弹窗也由操作系统管理。

## 修复行为

- Codex 请求提供 `availableDecisions` 时，严格按其顺序显示；明确空列表不擅自补允许项。
- 旧请求未提供该字段时，采用该 App Server 协议已支持的单次、会话、拒绝和取消决定；只有源端明确提出时才显示命令前缀或网络域名规则。
- 用户点击的只是当前请求的选项 ID。后端从该待请求读取原始决定并回传，客户端不能构造或扩大授权规则。
- 命令规则显示具体前缀，网络规则显示域名和允许/拒绝动作。UI 区分本次、此源会话、规则的作用范围，不承诺全项目或永久免确认。
- 权限包申请使用自己的 `{permissions, scope}` 协议，支持本轮或此会话，拒绝时回传空权限；不错误套用命令审批的 `decision`。未知 Codex 审批方法不提供允许项。
- 请求过期、运行已停止、未提供的决定和伪造选项均拒绝发送。
- Claude、DSH 等其他适配器只显示其已经验证的能力，不借用 Codex 的权限选项。
- 不静默变更用户配置，不开启无限权限，不建立 QuanDeck 自动批准白名单。源 Agent 保存并执行其会话/规则策略。

## QuanDeck 是否维护自己的 runtime

有自己的**执行适配与协调层**：`scripts/runtime/driver.mjs` 管理源进程、JSON-RPC、源 thread/turn 标识、待请求路由、受理回执、暂停恢复、事件投影与持久化。它还有独立的系统辅助请求（标题、摘要等），这会产生额外源调用。不能说 QuanDeck 完全没有自己的运行状态。

实际模型推理、命令执行、沙箱、工具审批和源会话仍由 Codex App Server、Claude SDK 或其他源 Agent 提供。QuanDeck 不应实现第二套工具执行器或审批策略。业务层负责版本化方向、任务依赖、交付槽及台帐；黑板是这些事实的可重建视图，不持有独立权限或完成状态。

对外应把“项目工作流协调”与“源 Agent 执行”分开说明。减少提醒的正确路径是传递源端提供的授权范围、避免重复业务决策和重复派发，并保持前置成果版本准确。不能把所有问题自动回答“是”。

## 验证依据

- 本机 `codex app-server generate-ts --experimental`（CLI 0.161.0），读取 `CommandExecutionRequestApprovalParams`、`CommandExecutionApprovalDecision`、`FileChangeApprovalDecision`、`ExecPolicyAmendment`、`NetworkPolicyAmendment`、`PermissionsRequestApprovalParams`、`PermissionsRequestApprovalResponse`。
- 协议回归覆盖源端有序选项、缺省与显式空列表、规则原样回传、非法扩权拒绝、过期请求、不同任务不本地自动批准、文件修改会话授权和其他 Agent 的降级边界。
- 该验证不运行真实模型或替用户修改源权限；具体规则生效及有效期由源 Agent 决定。
