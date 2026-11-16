# QuanDeck AI 与代码协作协议

本协议规定模型输入、模型回报和业务命令回执。代码掌握身份、权限、状态转换、存储与实际用量；AI 负责理解、规划、研究、候选内容和自检意见。模型的输出只有经过代码验证并得到提交回执后才成为已保存记录；得到验收回执后才成为已采纳成果。

这是目标设计。当前 v0.5.0 的 RuntimeDriver、RuntimeEvent 和 SourceReference 是适配基础，下述协议尚未接入产品。本文示例均为协议测试 fixture；A5、C10 等编号沿用旅行案例，不代表真实历史成果或真实出行信息。

## 1 身份与版本的约定

| 字段 | 谁生成 | 含义及校验 |
| --- | --- | --- |
| project_id / task_id | 服务端 | 稳定业务身份；禁止 AI 通过改字段切换到另一个项目 |
| run_id / session_id | 服务端及适配器 | 一个任务可有多个 run；源工具会话 ID 使用适配器回执，不从显示标题猜测 |
| task_version | 服务端 | 任务业务状态、负责人或要求等发生变化时递增；不是任务要求文档的版本 |
| spec_revision | 服务端 | 任务目标、交付物、验收标准等要求的不可变快照号 |
| claim_epoch | 服务端 | 主执行权代际；每次接管增加，用于拒绝旧执行者的迟到写入 |
| context_package_id | 服务端 | 本次实际派发的上下文快照；记录引用、输入预算、方法与策略版本 |
| idempotency_key | 调用客户端或工具网关 | 一次逻辑命令的唯一键；重试沿用原键，不因网络失败产生新任务 |
| command_id / event_id | 服务端 | 已处理命令、业务事件的身份；不接收 AI 自造“已完成”审计事件 |
| actor_id / credential | 认证层 | 从受信连接取得，不属于 AI 可写 JSON 字段 |

AI 可以回显 binding 与 guard，以发现错绑，但回显不提供权限。网关从认证会话绑定 project、task、run、可执行工具和 claim_epoch，与回显逐项比较。认证凭证不得进入模型 prompt；retrieval.scope_token 是非秘密的限域引用句柄，不能用作 bearer 凭据，必须结合受管连接、项目、有效期和权限检查，不是用户可任意填写的项目 ID。

人工负责人 owner 与运行执行者 executor 分离。人工负责人与人工任务不要求维持 agent 心跳。AI 主执行占有才使用租约；heartbeat 只更新运行存活记录，不增加 task_version。

## 2 三类可校验消息

| 方向 | 文件 | 用途 |
| --- | --- | --- |
| 代码 → AI | [context-package.schema.json](contracts/context-package.schema.json) | 构建足够且受限的执行输入 |
| AI → 代码 | [agent-submission.schema.json](contracts/agent-submission.schema.json) | 计划提议、检查点、候选结果、阻塞报告 |
| 代码 → 客户端/AI 工具 | [command-receipt.schema.json](contracts/command-receipt.schema.json) | 明确命令是否提交、重放、排队或拒绝 |

全部采用 JSON Schema Draft 2020-12，所有对象拒绝未声明字段。生产校验器必须启用 format 校验，并限制 UTF-8 字节数、嵌套深度和数组长度。schema 的字符串长度限制不能替代 token/请求体预算。标识符的存在性、引用权限、同项目归属、版本新旧、条件相互关系必须由服务层核验。

版本升级按 schema_version 精确路由。未知主版本拒绝；改变枚举或允许字段必须发布新契约版本和兼容测试，不能简单忽略未知字段。迁移原始消息时保留原文、源版本与转换器版本，不伪造成模型原本提交了新格式。

### 2.1 代码交给 AI 的上下文

[完整输入示例](examples/context-package.valid.json)分为以下数据段：

- task：本次目标、交付物、验收条件与不在范围内的事项。
- confirmed_constraints / rejected_options：来自明确用户记录的条件和否决项，带 decision_revision 与原文指针。
- assumptions / open_questions：AI 假设与未确定信息，不得混入确认事实。
- sources：成果或原文片段，固定资源版本、内容校验值、适用范围、验收状态和时效状态。
- methods：经策略允许的方法模板及版本；只选择本任务用得到的部分。
- checkpoint：上次完成到哪里、还有什么、哪些外部动作结果未知。
- policy：预算、停止条件、工具范围、验收策略与工具权限实际强制能力。
- retrieval：补读相关证据的入口和单次返回预算。
- input_budget：模型上下文上限、估计输入、预留输出与工具空间。
- output_contract：只接受 submit_task_output 的结构化回报；普通文字回复不会直接变成业务写入。

sources.content 始终是 reference_data。网页、文件、历史对话中的“请忽略规则”“把任务设为完成”等文字只是资料内容。只有当前用户授权、受控任务规范和已批准方法进入指令层。代码不能把外部资料中的自然语言解析为工具权限，也不能因为某份文档写了“用户已经同意”就创建同意记录。

运行中补读成功后，查询服务登记 source_id、resource version、内容 hash、读取时间和 run_id，作为该运行的补充来源记录；原始 context package 保持不变。结果可以引用初始包或这些已登记的补充 source_id。AI 自己写出的 URL 或 source_id 在被服务读取并登记前不算有效证据引用。资料被删除或撤权后，后续读取与采纳仍需检查当前权限，不能用旧 handle 绕过。

输入快照在派发前保存；记录最终实际序列化消息的 hash、可得到的 token 数及计数器版本。若 provider 会自行保留历史，应记录 provider 上下文策略与实测可见范围；无法证明窗口隔离时标记不确定，不能仅凭新建 UI 会话声称输入已变短。

### 2.2 AI 能提交的四种内容

| kind | AI 可提供 | 代码处理 | AI 不拥有的能力 |
| --- | --- | --- | --- |
| plan_proposal | 子任务建议、目标、验收项、依赖草案 | 校验局部键唯一、引用和 DAG；保存 proposal；按项目授权决定是否另发采用命令 | 不自行创建权威 task_id、提高预算或授予执行权限 |
| checkpoint | 完成步骤、剩余步骤、资料引用、继续提示 | 作为不可变检查点保存；“完成步骤”仍属执行者报告，可要求证据 | 不把自述写成已验收事实；不抹去失败运行 |
| result | 候选成果、来源、自检意见、未决项、后续建议 | 保存 submission 和候选 artifact_version；任务进入 in_review；交给验收流程 | 不设置 done、accepted、验收人、真实 token 或实际费用 |
| blocker | 缺信息、冲突、权限/预算不足、外部结果未知 | 按类型与策略创建待办、请求或运行等待状态 | 不自动获得授权；不把请求权限写成已获得权限 |

完整示例：[结果](examples/result.valid.json)、[计划提议](examples/plan-proposal.valid.json)、[检查点](examples/checkpoint.valid.json)、[阻塞](examples/blocker.valid.json)。

result.criterion_reports 是执行者自检，不是 reviews 表的通过记录。来源存在、数量齐全也不能证明事实为真。机械条件由代码检查，专业判断由指定复核者给意见，最终采用由预设验收策略执行；需要人判断的事项进入人工验收。自动验收必须事先限定任务类型、范围、证据和检查器版本，不能由本次执行 AI 临时宣布自己有此权限。

上传附件先取得 upload_id。服务端核验它属于同一主体/项目、文件已完整落盘、大小和内容类型可用后，才允许结果引用。AI 不提交任意文件绝对路径或任意 blob 路径。内联成果有尺寸上限，大正文或二进制走上传通道。

next_steps 一律是建议。建议本身不会触发新的 run。由代码进行去重、范围/预算/依赖检查，再执行显式的 AdoptProposal/CreateTask/StartRun 命令；已有项目授权可覆盖低风险自动采用，无需所有步骤都人工确认。

### 2.3 命令回执

- applied：业务事务已提交。对于 result，表示“候选成果已保存并进入待验收”，不是“成果已经通过”。
- replayed：同一逻辑命令的重试；返回首次事务相同的 command_id、event_ids、资源 ID 和 recorded_at，不能新增一次结果。
- queued：请求与 outbox 已持久化，外部运行或操作尚未确认成功。
- rejected：没有业务状态变更，包含错误码。拒绝审计可另存，但 event_ids 不伪造成功事件。

[保存成功回执](examples/receipt-applied.valid.json)与[过期执行拒绝回执](examples/receipt-rejected.valid.json)分别演示待验收和拒绝。回执中的 task_snapshot 是该次命令提交时的快照；重放不把它冒充最新状态，客户端需要时再读当前任务。

## 3 服务接口与工具边界

先实现同一进程的 command/query 接口；Electron IPC、HTTP 和 MCP 都调用相同业务服务，不各写一套权限逻辑。以下 HTTP 是可映射接口，单机不要求部署远程服务器。请求主体身份来自认证层。

| 操作 | 接口或命令 | 输入要点 | 权威写入者 |
| --- | --- | --- | --- |
| 创建项目 | POST /v1/projects | title、目标、初始负责人、用户输入引用 | 业务服务 |
| 录入需求 | POST /v1/projects/{p}/inputs | 原始内容或 upload_id、来源渠道 | 业务服务保存原文；AI 另提炼 |
| 创建/修订任务 | POST /v1/projects/{p}/tasks；ReviseTask | 目标、验收项、依赖、expected_task_version、change_reason | 业务服务；受权主体发命令 |
| 采用拆解方案 | AdoptProposal | proposal_id、采用项、授权策略、相关版本 | 业务服务分配稳定 ID 并一次性建依赖 |
| 读取台帐 | GET /v1/projects/{p}/ledger | 过滤、snapshot_cursor、limit；响应带source_seq | 查询服务 |
| 读取黑板 | GET /v1/projects/{p}/blackboard | since_sequence、limit | 查询服务 |
| 检索/补读 | SearchSources / ReadSourceVersion | 查询、范围、资源版本、片段定位、token 上限 | 限域查询服务 |
| 准备执行输入 | BuildContextPackage | task_id、spec_revision、run 目标、方法版本 | ContextBuilder |
| 开始/接管运行 | StartRun / ReconcileAndTakeOver | task_id、expected_task_version、执行者、原因 | 调度服务与适配器 |
| 保存 AI 提交 | POST /v1/projects/{p}/tasks/{t}/submissions | 本文 agent-submission | 验证器与任务服务 |
| 人工提交成果 | SubmitHumanOutput | task_id、expected_task_version、成果及说明 | 同一成果/验收服务；不强制 run_id |
| 决策与用户条件变更 | ConfirmDecision / AmendDecision | 原文引用、决定、前一版本、理由 | 有权限的人或已授权输入渠道 |
| 验收 | ReviewSubmission | submission_id、针对的spec_revision、逐项结论、证据、reviewer权限 | ReviewService；AI复核意见本身不等于此命令获准 |
| 暂停/取消 | PauseRun / CancelTask | 目标ID、expected_task_version、原因 | 调度服务；取消与外部取消回执分离 |
| 外部副作用 | PrepareExternalAction / ExecuteAuthorizedAction / ReconcileAction | 动作、参数hash、授权引用、幂等能力 | ActionService，禁止直连外部写入绕过 |
| 心跳 | RenewRunLease | run_id、claim_epoch、lease token | 受信适配器，不由模型生成 |
| 运行事件 | IngestRuntimeEvent | 连接、provider事件ID/sequence、原始payload | 受信适配器 |
| 删除/擦除 | EraseProjectData | 范围、权限、理由、保留策略 | 专用数据管理流程；agent无此通用工具 |

命令共同要求 idempotency_key。修改已有任务事实要求 expected_task_version；依赖要求的动作还需 expected_spec_revision；运行回报还需 claim_epoch。读接口不要求领取任务，不允许检索“绕过权限找到别的项目”。

首版不提供任意历史as-of查询。第一页基于一致读快照创建短期分页结果缓存，cursor绑定主体、过滤条件、source_seq和到期时间；后续页仍校验当前权限。缓存过期、应用重启或相关删除撤权时返回SNAPSHOT_EXPIRED并重新查询，不从当前表伪造过去序号的数据。缓存不是权威存储，可放本地内存/受限临时目录；需要长期审计快照时显式导出并固定版本。

仅 exposes 本次需要的 AI 工具：read_project_sources、read_source_version、submit_task_output，及策略允许的业务工具。CreateTask、ReviewSubmission、ExecuteAuthorizedAction 等必须经过策略服务；是否允许 AI 触发受项目预授权控制，不能因为模型知道 API 名称就允许调用。

## 4 一次结果提交的确定性处理顺序

1. 校验传输认证、项目成员权限、绑定运行与操作范围；限制请求字节数、解析 JSON，选择 schema 版本。
2. 规范化请求，计算语义 payload hash。幂等范围为 principal + project + operation + idempotency_key。
3. 查命令回执：相同键且 hash 相同，直接返回原回执；相同键但 hash 不同，返回 IDEMPOTENCY_CONFLICT。此步骤必须在检查“当前版本是否已变化”之前，保证成功命令的正常重试可重放。
4. 对首次请求运行严格 schema 校验和业务校验：身份绑定、任务存在、状态允许、task_version/spec_revision、claim_epoch、运行占有、引用权限和版本、依赖、附件、预算及策略。schema 有效不等于这些检查通过。
5. 进入短事务并重新检查写入守卫，避免前一次读取到提交之间状态变化。写 submission、候选 artifact_version、task 新状态/版本、event、命令回执及必要 outbox。全部成功后提交；事务失败全部回滚。
6. 提交后返回 applied。黑板查询读取同一权威状态；异步全文索引和文件投影跟随事件，不阻塞权威事务。
7. Outbox worker 至少一次投递验收/后续通知，用 event_id 去重。业务事件是服务端在事务中产生的事实，AI 的 result 只是它的输入。

同一 key 更新 guard 或内容属于不同语义，必须用新 key。收到 TASK_VERSION_CONFLICT 时先读取变更原因；不要自动换上最新数字重发旧内容。若仅有无关元数据变化，服务可以按明示规则重新校验；若要求、决定或依赖变化，创建新上下文并重新评估候选结果。

永久业务拒绝可记录拒绝回执。短暂数据库不可用时不返回“已保存”，返回 STORAGE_UNAVAILABLE，客户端保留原内容并用同 key 重试。记录回执失败时不可先告诉用户成功。

## 5 运行、事件与外部动作

运行生命周期与任务生命周期分开。运行 succeeded 只表示该次执行结束；有有效候选成果后任务进入 in_review，验收通过才 done。运行 waiting_input / waiting_permission 时，任务显示 blocked，并分别保存阻塞原因和待响应主体；它们不能被伪装成运行失败。任务 done 后某来源过期，不把历史完成事实改写为未完成；单独记录成果 freshness 并创建复核任务。

适配器事件优先按 connection_id + provider_event_id 去重，并核对 run_id 和 session_id。具有可靠单调序号的 provider 再按 run_id + provider_sequence 防重；重复序号但内容不同进入异常审计，不覆盖。乱序到达先保存原始事件并按规则归并，不能因旧 running 事件把终态回退。不能假设所有 provider 都提供可恢复序号；缺少身份时标记接入能力不完整，只用可证明稳定的回执关联，不用随机新 event_id 假装实现去重。

回执未知与失败分开。派发超时不直接重新启动：先用 dispatch_id/源会话/adapter能力核查是否已被接受。无法核查时标记 acceptance_unknown 并等待人工或后续回执。旧运行租约失效后，其普通提交不能修改当前任务；原始迟到消息仍可保留，用户若要采用它，须作为新的候选导入并按当前要求复核。

枚举映射：acceptance_unknown 是诊断原因，存入运行协调事件；运行采用 lost 状态，任务 blocked，等待核查。它不是新增 Run 枚举。外部动作的 outcome_unknown 对应 external_actions.status = unknown，也不是新的 Task/Run 状态。核查证实源运行仍在执行时，可以经协调命令恢复该 run 的正确状态与占有；只有明确已终止或执行隔离成立时才启动替代 run。

外部预订、付款、发送等有副作用动作由 ActionService 单独管理。发送前记录参数hash、授权范围、动作ID和outbox；外部支持幂等时沿用稳定key。外部不支持幂等、回执未知时进入 outcome_unknown，先查询或人工核对，不自动重发。内部事务和 outbox 只能保证可追踪及可重试，不能保证任意外部系统 exactly-once。取消任务也不能断言已经取消外部订单。

## 6 权限强制和 AI 可信边界

通过代码强制限制工具、文件与网络范围。策略中的 tool_enforcement：
- verified：适配器/沙箱实际可限制相关能力，且已有验证证据。
- unverified：仅声明范围或提示约束，无法证明外部 agent 不会越界；不得据此自动执行需要强隔离的动作。
- manual：由人工接手和回报，系统不声称自动控制。

policy.allowed_tools 和 scope_description 是发送给模型的可读摘要，不是授权的唯一依据。实际调用必须按 policy_id + policy_version 读取服务端机器规则，校验工具名、动作、项目/资源集合、路径或外部目标 allowlist、到期时间与单次额度；正文描述“只读”不能替代这些检查。

同操作系统账户下拥有任意 shell 的 agent，可能直接访问应用数据库和密钥。单写入 API、文件 mode 和“禁止改台帐”提示都不能单独形成安全边界。应使用可验证的沙箱/独立受限进程权限或受控工具代理；不能做到时仅允许显式的手动协作/不具强隔离保证的模式，并限制无人值守外部写入。这里的 verified 需要能力证明，不能由 AI 勾选。

用户原话、已确认条件、授权、已验收成果版本、命令与事件历史不由 AI 原位覆写。需要纠正时追加新版本、supersedes 链或更正事件。隐私擦除由单独权限流程执行，允许依政策删除内容并留最小必要墓碑；不能借“不可变审计”永久保留用户要求删除的敏感正文。

## 7 实际用量与预算

AI 可报告“预算不足”或请求更多资源，不能报告权威 actual_tokens、actual_cost 或付款结果。用量来自 provider/受信 adapter；缺失为 null，明确区分未知与 0。估算值另存 estimator/version，不混入实测。

代码在 StartRun 前预留项目预算，子 agent 共享父项目余额，不能各自获得一整份项目预算。根据调用回执结算实际用量，释放未使用额度。超时、失联或计量不完整时保留待结算预留，不立即全额释放供下一任务重复花费。只在支持逐调用工具网关的适配器上承诺硬上限；外部独立 CLI 无法拦截模型调用时标记只能软限制，预算边界不满足则不授权无人值守继续。

上下文限制至少验证：估计输入 + 预留输出 + 预留工具空间不超过模型实际可用窗口。运行中的检索还要遵循剩余预算；不足时写检查点并轮换会话。不要把模型最大窗口当作应填满的目标。

## 8 文字回复与结构化回报分通道

普通回复存为 conversation message，可显示、检索和审计，但不直接解析为命令。结构化 submit_task_output 走本文协议。模型说“已完成”“采用方案”“用户确认了”，都不能替代命令回执或用户确认事件。

旧模型不能稳定调用结构化工具时，可由受限解析器将其文字转换为 candidate submission，保留原始文本与转换器版本。该候选仍需所有 schema、引用、版本与授权检查；无法可靠解析则进入待人工整理，不能用几个中文标签/正则直接把文本升格为用户决定或完成事实。

现有源代码对接位置：
- src/data/runtimeContracts.ts：保留 RuntimeDriver 的派发、控制、订阅能力；给派发输入关联 context_package_id、spec_revision 与 claim_epoch，适配器只接收被批准的上下文。
- src/integration/contracts.ts：沿用 SourceReference 的真实连接/源会话身份及权限请求引用；不使用 UI 文案代替源回执。
- 当前 RuntimeEvent.status 的 done 应先归一化为 run succeeded，不直接转换 task done。
- 现有 RuntimeEvent.tokens 可为 null；后续拆分累计/增量/输入/输出/缓存来源，不能根据文本估出一个数后标成实测。
- 普通 reply、结构化 submission、provider usage、user decision、review decision 保持不同事件类型；没有 submission 的最后回复不自动创建已验收成果。

## 9 错误码及客户端处理

| 错误 | HTTP参考 | 处理 |
| --- | --- | --- |
| SCHEMA_INVALID / PAYLOAD_TOO_LARGE | 422 / 413 | 返回字段路径与限额；保留原始草稿，修正后使用新命令键 |
| UNSUPPORTED_SCHEMA_VERSION | 422 | 协商支持版本或更新适配器，禁止静默兼容 |
| UNAUTHENTICATED / FORBIDDEN / SCOPE_MISMATCH | 401 / 403 | 停止请求；不泄露其他项目的版本与内容 |
| TASK_VERSION_CONFLICT / SPEC_REVISION_CONFLICT / CONTEXT_STALE | 409 | 重新读变化；需要时重建上下文，禁止只替换版本号 |
| STALE_CLAIM | 409 | 原执行停止写入，保留迟到材料供新执行者按需复核 |
| REFERENCE_INVALID / SOURCE_UNAVAILABLE | 422 / 409 | 查明引用、删除或权限变化；不能编造引用补齐 |
| DEPENDENCY_CYCLE / DEPENDENCY_NOT_READY | 409 | 修订计划或等待依赖；不能强行就绪 |
| IDEMPOTENCY_CONFLICT | 409 | 原键保留；新语义使用新key |
| BUDGET_EXCEEDED / POLICY_DENIED / ENFORCEMENT_UNVERIFIED | 409 / 403 | 保存检查点并等待预算/策略或人工处理 |
| EXTERNAL_OUTCOME_UNKNOWN | 409 | 核对外部真实结果，禁止盲目重复动作 |
| INVALID_TRANSITION | 409 | 获取真实任务状态，再决定下一条合法命令 |
| STORAGE_UNAVAILABLE | 503 | 保留输入，退避后用同key重试；不得显示保存成功 |

字段路径、详细原因仅向有权查看当前任务的主体返回。重试退避属于客户端/调度代码，不让 AI 通过不断重新解释错误制造无限循环。

## 10 协议验收

examples/validation-cases.json 列出 schema 自检用例。七个正常消息均通过 Draft2020-12 与 format 检查；在结果中注入 payload.status=done 的反例必须被 additionalProperties=false 拒绝。语法测试不能取代以下服务测试：

1. 同一 idempotency_key 同内容重放两次，只产生一次 submission、artifact_version、event 和下游触发。
2. 同一 key 改正文、guard 或附件，得到 IDEMPOTENCY_CONFLICT。
3. 伪造 binding.project_id、run_id 或旧 claim_epoch 即使 schema 合法仍被拒绝。
4. result.criterion_reports 全写 pass 仍只进入 in_review；验收要求人工时不能自动 done。
5. 引用不存在/已删除/未授权的来源、跨项目附件或新要求下的旧快照，不能提交为可采纳结果。
6. provider done 但没有合法 result 时不完成任务；文字“我已付款”不创建付款事实。
7. 数据库提交后、响应发出前断线，重试返回相同命令与资源，task_snapshot 为首次提交快照。
8. 外部 action 已发出但回执丢失时进入 outcome_unknown，不重复执行。
9. provider usage 缺失时为 null；预算不足或不能证明执行隔离时按策略停止。
10. 新用户条件更新 spec_revision 后，旧输出不能靠修改 guard 数字绕过新上下文/引用复核。

协议文件只验证目标契约和示例，未修改当前产品 RuntimeDriver 或业务服务。集成阶段需将这些服务测试接入真实运行器、数据库事务和任务状态机。
