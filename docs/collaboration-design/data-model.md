# QuanDeck 协作数据模型与存储设计

本设计把任务、执行、会话、成果、用户决定分开保存，采用本地 TypeScript 业务服务统一写入 SQLite，正文与附件按不可变文件保存。台帐和黑板是这些数据的查询结果，不能形成第二套事实。本文件配套的 `schema.sql` 是可在空库运行的目标 DDL，不是生产迁移脚本，也不代表后端已经实现。

## 1 现有结构如何接续

基线为 QuanDeck 0.5.0，commit `e8cb0ab68eb1c30b3efd121dd33680f49e1ace5c`。

| 现有对象或文件 | 已有能力 | 本设计的迁移方向 |
|---|---|---|
| `Task` 与 `WorkItem` | 主任务、稳定子任务、依赖、负责人 | 统一为层级 `tasks`，通过 `parent_task_id` 保留层级，保留旧 ID 到新 ID 的映射 |
| `Attempt` | initial/retry/resume/reassign 独立执行记录 | 导入 `runs`；每次接管增加执行代际，旧记录仍可查 |
| `Session` 与 `RuntimeRunInput` | 会话来源、dispatchId、真实 runtime 回执 | 保留连接身份与源会话 ID，不把本地 task ID 冒充供应商会话 ID |
| `IdeaPlan.adopted`、`DiscussionConclusion` | 草稿与采纳分离、来源结论 | 提案写 `proposals`；采用后的要求写不可变 revision；原始来源写 `source_records` |
| `TaskOutput` | 人工/AI 输出、草稿/发布、附件 | 导入成果版本，旧发布状态记录为 legacy provenance，不能自动补造验收人或验收记录 |
| `desktop/app/local-store.mjs` | `workspace.json` 原子替换和上一版备份 | 保留导入来源，迁到业务事务；不能让 JSON 和 SQLite 长期双向双写 |

`Task.completion.reason=all_archived/manual` 只证明旧版发生过相应完成动作，不证明新协议已验收。导入时使用 `completion_kind=legacy_import`，保存原值、来源文件 hash、导入批次和时间；UI 显示“历史完成，按旧规则记录”。新任务必须通过新验收流程。

## 2 三种版本不能混为一谈

| 字段 | 变化原因 | 不变化的情况 |
|---|---|---|
| `tasks.version` | 状态、负责人、正式要求、执行占有、验收指针等业务变更；用于 CAS | 心跳、流式 token、原始日志到达 |
| `tasks.spec_revision` | 目标、交付物、约束、验收条件被正式修订 | 普通进度、暂停、恢复、失败 |
| `tasks.claim_epoch` | 任务第一次执行或接管到新的运行；用于拒绝旧执行者写回 | 同一运行心跳和工具进度 |

协议中的 `expected_task_version` 对应第一项，`expected_spec_revision` 对应第二项，`claim_epoch` 对应第三项。`artifact_version` 和 `decision_revision` 分别定位成果与决定的不可变版本。不要用一个全局 Snapshot.version 代替这些条件，否则无关任务的一次更新就会制造冲突。

业务版本是比较并交换的防并发条件，不是授权凭证。`actor_id`、项目访问权和本次执行授权来自已验证的 IPC/连接上下文，不能信任 AI 在 JSON 中填写的身份。

## 3 逻辑模型与权威来源

| 表组 | 保存内容 | 可更新内容 |
|---|---|---|
| `actors`、`project_members` | 人、agent、服务身份和项目角色 | 显示名称、停用、经授权的角色变更；身份 ID 不变 |
| `projects`、`project_revisions` | 项目当前状态、目标/范围/预算/策略的版本 | 当前指针与项目状态；旧 revision 不覆盖 |
| `tasks`、`task_revisions` | 稳定任务、负责人、状态、当前要求快照 | 仅通过业务命令修改当前字段；要求改动追加 revision |
| `task_dependencies` | 有向依赖关系与解除条件 | 经版本校验后增删边；修改写事件；不得产生环 |
| `sessions`、`runs` | 源会话身份、每次执行、占有代际、运行状态 | 运行状态/心跳/供应商游标；原执行归属不改写 |
| `proposals` | AI 或人提出的任务拆分、修改、下一步建议 | 原提案内容不可改；采用/拒绝/取代状态可变并引用事件 |
| `decisions`、`decision_revisions` | 用户条件、偏好、选择、否决与授权 | 当前版本指针；原决定追加修订，不能把 AI 假设改写成用户原话 |
| `context_packages`、`context_items` | 发给运行的实际输入包、精确引用、hash、预算 | 发布后不可变；补充检索生成新的记录，不编辑已发输入 |
| `source_records`、`checkpoints` | 输入原话、供应商证据、外部材料、断点 | 仅追加；正文可用 blob 承载 |
| `artifacts`、`artifact_versions`、`artifact_inputs` | 稳定成果、不可变内容、来源版本关系 | 成果当前/采用指针与时效标记可变；正文及来源快照不覆盖 |
| `submissions`、`reviews` | 提交原件、接收判断、验收记录与证据 | 仅追加；退回后生成新提交，不修改上一份记录 |
| `events`、`command_receipts` | 业务变更、请求去重及原返回值 | 仅追加；同 key 不允许对应另一请求体 |
| `outbox`、`external_actions` | 事务提交后待做动作、外部副作用状态 | 发送重试和对账状态；同动作固定参数与幂等键 |
| `usage_observations`、`budget_reservations` | 来源用量、估算与真实计费、执行前预算预留 | 用量观测追加；预留结算状态可更新；未知不填 0 |
| `blobs`、`projection_offsets`、`erasure_jobs` | 文件元数据、读模型游标、删除维护回执 | 文件可用性、游标和受控维护状态 |

表数量不等于服务数量。以上都属于同一个应用后端模块化单体；无需拆成多个网络服务。

普通任务的关系为 `Project → Task → Run → Session`，其中 Task:Run 为一对多；同一供应商会话可承担同一任务的多次续做，但任务更换时应新会话。首版人工任务不创建 run/session，人工提交直接归入 task，详细计时保存人工活动事件，不设置 agent 存活租约。

新协议不允许把执行中的会话重新绑到另一个 task 来转移责任。旧版的换绑历史保留为来源记录，活动执行归属则固定。观察到的外部会话先允许 `sessions.task_id=NULL`，人工明确归档后关联；含多个任务的旧聊天按来源片段引用，不能伪装成干净的单任务执行上下文。

内部session可先于provider受理创建：origin=dispatch时source_session_id允许NULL，受理后由adapter填真实值；observed/import必须有真实源ID。AI规划使用独立planning Task和discussion Run；AI复核使用独立review Task和review Run，均使用本Task的epoch，不争用产出Task。reviews.run_id表示产出Run，独立复核Run及advisory成果通过evidence_json引用并由服务验证。复核Task以合法submission已存在为就绪条件，不等待产出Task done。

## 4 SQL 能保证什么，业务服务必须保证什么

`schema.sql` 使用同项目复合外键，避免仅靠随机 UUID 碰巧不相同来隔离项目。可变当前指针引用不可变版本；创建时使用一个事务同时插入主记录与 revision，延迟外键在提交时校验。

| 不变量 | 数据库约束 | 业务服务守卫 |
|---|---|---|
| 任务引用同项目实体 | 复合外键 | 身份与项目授权；拒绝跨项目检索和输入注入 |
| 任务 ID 与来源归属稳定 | 外键 + API 不开放主键编辑 | 不提供任意 SQL、整对象覆盖或重新归属运行接口 |
| 正式要求、用户原话、成果版本、事件不可覆盖 | append-only 表的 UPDATE/DELETE 触发器 | 不允许借“新增同义记录”静默替换事实；生效必须有受控命令 |
| 一个任务只有一个当前主执行者 | `active_run_id` 只可指向本任务；每个 epoch 一个 run | CAS 原子领取；所有执行写回核对 active_run_id、epoch、run 状态、租约和要求版本 |
| 任务完成有依据 | done 必须带 review 或 legacy 来源 | review 必须 accepted、对应当前 spec_revision 与精确提交/成果版本，验收人有权限，必选子任务和依赖满足 |
| AI 不能自己验收 | ai_advisory 模式不能写 accepted verdict | 模式由认证身份和策略决定；AI 不能把自身伪装为 human/policy |
| 用户确认条件受保护 | 旧决定 revision 不可改 | confirmed/withdrawn 必须来自用户有效操作或既有明确授权；AI 只能新增 proposed |
| 任务关系无环 | 拒绝自依赖 | 增边和变更父任务时在同一事务内验证 DAG 与父子祖先关系 |
| 精确来源版本有效 | 被引用的已知实体有外键；json_valid | 检查 JSON Schema、引用可访问性、revision/hash、有效期、引用片段与原文一致性 |
| 预算不被并发超分配 | reservation 唯一且非负 | 在写事务内计算已结算与预留；同预算单位/货币比较；未知用量保持占用或人工核验 |
| 副作用不被乱重试 | 动作幂等键、outbox 去重 | 超时后先对账，不能把“未收到结果”解释成“未执行” |

`context_items` 与 `artifact_inputs` 的多态引用由服务解析，并在同一事务中检查目标版本、权限、hash 和来源。`artifact_versions.run_id` 必须属于 artifact.task_id。`submissions` 中 null run 只允许有权限的人工作者；AI 提交必须完整绑定 run、context package、epoch。以上不会因为 JSON 是合法格式而自动成立。

公开的写入入口必须采用白名单命令和白名单字段，不提供 `PATCH /task` 任意更新。SQLite 文件权限也不是同一操作系统用户下任意 CLI agent 的安全沙箱；需要进程/工具访问隔离，禁止执行者读写应用数据目录。若允许 agent 任意 shell 访问同用户全部文件，不能声称数据库不可被绕过。

## 5 一次变更的事务规则

每次业务命令由代码执行以下逻辑，AI 不负责决定是否跳过其中步骤：

1. 验证调用者身份与 scope；解析协议版本和 JSON Schema，拒绝多余敏感字段。
2. `BEGIN IMMEDIATE`。查询 `(project_id, actor_id, operation, idempotency_key)`。
3. 已有相同 key 且 request hash 相同，返回原 receipt；hash 不同返回 `IDEMPOTENCY_CONFLICT`。
4. 读取 task.version、spec_revision、current policy；验证 expected 版本、权限、依赖、当前占有和预算。
5. 写入领域变化和不可变快照，按业务变化递增 task.version。心跳单独命令，只更新 run 字段。
6. 增加 project.event_seq，追加 domain event；同事务写 command receipt 和必要 outbox。
7. 提交。事务成功后才回复“已保存/已接收”；失败时返回失败，不可先显示成功。
8. 后台 dispatcher 发送 outbox，投影生成器更新台帐/黑板/索引。所有消费者按 event_id 去重。

派发网络请求不能放在持有 SQLite 写锁的事务中。事务先提交 `run queued + dispatch outbox`，发送后记录供应商受理回执；受理结果未知进入对账状态，不立即创建第二个运行。

领取的关键更新形式为：

```sql
UPDATE tasks
SET active_run_id = :run_id, claim_epoch = claim_epoch + 1,
    status = 'running', version = version + 1, updated_at = :now
WHERE project_id = :project_id AND task_id = :task_id
  AND version = :expected_task_version
  AND spec_revision = :expected_spec_revision
  AND status = 'ready' AND active_run_id IS NULL;
```

只有 affected rows 为 1 才成功；run 插入、预算预留、事件和 outbox 同事务完成。新 run 使用更新后的 epoch。运行排队也占有该任务；若需排队取消，必须通过释放命令记录原因。

心跳不是进展证明，也不能自动完成任务。租约逾期只说明“失联”，先暂停新的有副作用操作、查询供应商状态。确认旧执行已停止或被有效隔离后，增加 epoch 并接管；旧运行迟到内容可存来源审计，但不能变更当前任务或触发下游。如果无法约束供应商继续执行外部动作，保持 blocked/uncertain，不能仅靠 epoch 就宣称外部无重复执行。

## 6 成果与验收的事实层次

`artifact_versions` 保存内容，`submissions` 保存执行者提交了什么，`reviews` 保存验收结论。三个动作不能合并成“AI 返回文本，所以任务完成”。新成果可先存在但尚未被采用；`artifacts.accepted_version` 只在验收成功事务中改变。

验收事务必须校验任务未取消、要求未被修订、提交当时来自有效运行或合法人工提交、成果版本和验收清单吻合；产出Run已正常结束不影响合法提交的后续验收。写入 accepted review → 设置 accepted_version → 更新 task 为 done → 清除活动运行占有 → 生成事件/outbox，应作为一个原子业务命令。AI 的自检报告只是验收输入。客观测试可由代码策略自动验收，主观质量可由人验收；另一个 AI 的评价存为 advisory，不能自行取得最终权限。

成果的 `freshness` 和历史验收独立：一篇旧交通攻略可以“当时已验收，今天已过期”。标记 stale 不抹掉 accepted_version，也不把已完成历史任务静默改回未完成。系统提出复核任务，或用户明确重开原任务并追加要求 revision。预算、日期等条件改变时，通过 `artifact_inputs` 反向查询受影响结果，标注影响；无法证明未受影响时标 unknown。

每一成果版本的核验日期、适用期、适用条件保存于该版本metadata_json。artifacts.freshness是当前被选用版本的查询缓存（优先accepted_version，没有时为current_version），不能用它代表全部旧版本。按ID读取指定旧版本时结合该版本元数据、当前条件与撤权/删除状态重新判断时效。要求变更、撤回采用与退回修改时按命令释放已结束的active_run占有，历史Run保留，下一次领取使用新epoch。

## 7 台帐和黑板如何保存

事实源是当前领域表及其不可变版本，`events` 是同事务追加的审计日志和增量通知。MVP 不要求从事件流重放重建全部业务库；黑板和台帐可以直接从领域表重建。这避免在第一版引入完整 event sourcing 的额外维护成本。

建议目录位于 Electron `app.getPath('userData')/collaboration/`，实际绝对路径由应用返回，不能让 agent 猜：

```text
collaboration/
  collaboration.sqlite
  collaboration.sqlite-wal
  collaboration.sqlite-shm
  blobs/<project_id>/<blob_id>
  projections/<project_id>/generation-<seq>/ledger.json
  projections/<project_id>/generation-<seq>/ledger.md
  projections/<project_id>/generation-<seq>/blackboard.json
  projections/<project_id>/generation-<seq>/blackboard.md
  projections/<project_id>/current.json
  backups/<backup_id>/database.sqlite
  backups/<backup_id>/manifest.json
```

创建项目时，一个数据库事务写 project、revision、owner、project_created 事件，初始化三类 projection offset。投影器读取数据库一致快照，以其 event_seq 生成同一代台帐/黑板；写临时文件、校验 hash、原子替换 current.json，使读者同时看到同一代文件。project.id 固定，文件标题和路径别名变化不修改实体 ID。

每份导出包含 `project_id / generated_at / source_seq / schema_version / generated=true / content_hash`。台帐导出保存任务索引和事实字段；黑板导出只保留当前目标、活动任务、阻塞和决策入口。AI 概括必须另有 `summary_generated_at / based_on_seq / source_refs`，且不能覆盖状态列。投影落后时查询 API 返回当前数据与生成进度，不能把旧文件状态当实时状态。

应用启动不重读整个台帐作为 prompt。读取 API 支持筛选、游标分页、字段选择和长度预算；完整导出供人审计和迁移。外部编辑 ledger.md/blackboard.md 不会被反向覆盖数据库。用户希望采用手工修改时，显式“导入修改”生成差异 proposal，再走正式命令；不得自动 last-write-wins。

文件损坏或被删可以重建；数据库损坏必须停止业务写入并从已验证备份恢复。不能通过读取旧黑板推测并补造任务完成状态。

## 8 文件提交、备份与恢复

大正文、图片、音频、附件及必要原始回执保存在 blob 文件，数据库保存用途、大小、类型、hash、归属与引用。密钥不放数据库正文、prompt、导出或日志，使用系统凭据存储和连接引用。当前 SQL 不提供数据库加密；若产品要求静态加密，应明确选用加密存储并验证备份和恢复，不可把文件权限称作加密。

附件落盘顺序：生成不可预测 ID → 写受限 staging 临时文件 → 校验大小/MIME/hash → fsync/原子移动到最终不可变路径 → 事务登记 ready blob 和成果版本。DB 提交失败可能留下未引用文件，由有宽限期的 GC 清理；不得先登记 ready 再异步保存内容。GC 仅在没有任务、成果、上下文、备份、待发送动作引用时清理，不能让正在运行的任务丢材料。

SQLite 运行连接启用 foreign_keys；单写入队列统一写锁，WAL 允许读写更顺畅，但仍只有一个同时写入者。数据库放本机磁盘，不把运行中的 sqlite/wal/shm 放到网络共享盘或网盘同步文件夹。多人多机器阶段由中心后端管理写入，换成 PostgreSQL 等服务端数据库；不要让多台机器直接共享一个 WAL 文件。[SQLite WAL 文档](https://www.sqlite.org/wal.html)

备份使用 SQLite backup API/一致快照能力，在同一备份窗口冻结 blob GC，记录全部引用 blob 的 hash 清单，复制或引用到受保护备份集合后再标记备份完成。不能只复制主 sqlite 文件而忽略未 checkpoint 的 WAL。恢复在新目录校验数据库、所有引用文件和 schema 版本，再切换数据根目录；恢复后的运行全部进入待对账，不自动重放外部副作用。

## 9 预算、派发与未知结果

预算上限位于项目策略 revision，`budget_reservations` 记录启动前为每个 run 预留的 token、费用或时长。采用单一比较单位，费用必须带货币。并发启动在同一写事务内检查“已结算 + 未释放预留 + 本次预留 ≤ 上限”。预留不足时不得派发。供应商不能报告真实用量时将其记录为 unknown/estimate，不能显示零成本或无限自动运行。

真实计费来自 `usage_observations` 对应的来源回执；累计采样不能相加，delta 按供应商指标键去重。输入、输出、缓存 token 分开保留，父运行和子运行按照供应商覆盖范围防止重复统计。计费可能晚到且可能超预留，结算保留实际数值并停止新的派发；应用预算不是供应商硬限额的替代品。

outbox 提供至少一次投递。消费者使用稳定 dispatch_id/action_id 和供应商幂等键去重；没有供应商幂等能力时不能承诺 exactly once。预订、发邮件、支付、部署等动作在 `external_actions` 保存固定请求 hash、精确授权 revision、外部关联 ID 与结果状态。网络超时改为 unknown，保留预算占用并查询外部状态；既不能自动重试，也不能标为失败后把占用释放掉。

人工在 UI 直接触发的受管外部动作也通过 ActionService：记录 `requested_by_actor_id`，`run_id/claim_epoch` 可为空，不为人工伪造 AI 运行。此时服务验证已登录用户身份和动作授权；AI 请求必须绑定有效 run 与 epoch。人工在线下完成的动作只保存人工说明、凭证及提交来源，不伪造供应商执行回执。

授权是带范围、参数约束、有效期和撤销状态的决定。外部动作发出前重新检查当前授权与要求版本；即使最初 context package 内存在旧授权，也不能忽略用户随后撤销。

## 10 修改边界与受控删除

正常业务中绝不能覆盖的内容是原始用户输入、已发布的要求/决定/成果版本、原始提交、验收记录、实际用量回执、历史事件和已发出的输入包。错了就新增纠正或替代记录并移动当前指针；不得为让历史看起来顺利而修改失败原因、验收人或时间。

“不可变”不是“用户永远不能删除隐私”。用户明确要求擦除时，后端创建 `erasure_jobs`，验证权限、列出范围与依赖、暂停相关运行及待发动作。维护进程在独立受控路径重建保留数据，移除/脱敏受影响正文和来源，并重新生成索引、台帐、黑板和上下文副本；普通 agent 工具不能调用 SQL 或关闭触发器。

删除后的引用保留最小 tombstone，显示“用户已删除来源”，不可再把旧摘要当可验证证据。对项目整体删除，删除回执只保留不含内容的 opaque ID 和范围计数，存于剩余工作区审计区。备份、已导出文件、外部供应商保留副本分别处理：受管备份按策略擦除或到期；不可控制的外部副本明确列为限制，不能宣称已全面消失。`erasure_jobs` 不设项目外键，就是为了项目已删除后仍保留最小维护回执。

## 11 迁移与上线顺序

1. 停止写入旧库并建立 `workspace.json` 与附件的可恢复备份；保留版本号和 hash。
2. 在新目录创建空 SQLite，导入项目/任务/子任务/会话/执行/输出。保留旧 ID，必要时以稳定命名空间映射，映射表随迁移批次记录。
3. 对旧人工锁、用户编辑项、已采用方案、否决项和完成来源逐项映射，不能通过 AI 摘要来决定旧数据是否保留。
4. 不完整的来源和验收记 unknown/legacy，不伪造；旧运行按暂停/待对账导入，不自动执行。
5. 核对记录数量、关系、hash、代表性项目读取、空项目、缺附件和损坏输入；生成迁移报告。
6. 通过后原子切换数据源，旧 JSON 改只读。没有恢复新库后新增业务数据的方案时，不允许直接回退旧 JSON 继续写。
7. 首先只上线读模型与人工流程，再启用受控 Agent 派发、自动验收与后续调度。每阶段分别验证，不把 schema 检查称为产品验收通过。

## 12 本设计自检范围

执行 `python3 docs/collaboration-design/check_schema.py` 会在内存空库运行目标 DDL，验证外键、不可变记录、同项目引用、完成依据、AI 不可自批、占有代际、心跳隔离及幂等键等数据库边界。它不修改产品数据，也不验证服务层权限、CAS 竞争、供应商恢复、业务状态机或UI。

完整后端仍需按主设计与 acceptance.md 实现事务命令并运行集成和故障注入测试。所有 JSON 字段虽有 json_valid 检查，仍必须按协议 Schema 和业务规则验证；合法 JSON 不等于合法业务事实。
