# QuanDeck PRD 本地实现验收矩阵

依据：`output/prd-figma-20261116.md`，Figma Spec `bydWIwQXe6uqTgH0AWHhgg / 0:5`，读取日期 2026-11-16。该文档含 FR-01—44；除 FR-26、FR-43 外均为 P0。用户后续已要求项目管理、最近任务替代最近会话、去掉顶部执行汇总、干净安装，这些后续要求优先。

本表是实现审计，**不是全部通过的声明**。源码存在、替身测试通过、真实工具测试和安装包验收分别记录；最后两项不能由 mock、静态截图或接口定义替代。总任务可在得到实测证据后更新对应行。

## 已建立的真实数据链

Electron 主进程磁盘库 → `createRuntimeDataSource` → `RuntimeDriver.run/control/scan` → 源端事件 → 项目内 Session/Attempt/结论/Timeline → IPC 快照。每个项目独立保存连接 ID 和目录；每次派发固定任务、方法版本、prompt、连接和源会话。已知中断只恢复记录到暂停，用户继续后才向源端发送，不重放旧 prompt。

`runtime-data.test.ts` 已验收事件早到、重复、过期、跨项目、嵌套、并行权限 ID、轮结束与归档、人工子任务条件、真实结论来源、双向关联／显式换绑／历史快照、扫描去重、只读回源及重启历史。`Agent` 安装、登录与协议实测由 bridge/native 集成测试提供额外证据。

## 功能逐项

| 功能 | 现有落点 / 本次变化 | 验收状态或缺口 |
|---|---|---|
| FR-01 自由文字、TODO 层级 | Journal/Composer/repository；新待办插首行 | 业务数据已测；真实鼠标编辑与移动端回归待总任务验收 |
| FR-02 纸飞机派发 | DispatchButton → RuntimeSource.dispatch → Driver | 幂等与受理回执已测；四目标真实派发分别待验 |
| FR-03 默认委派 | setDefaultAgent、独立本次 agentId | 原业务回归通过；真实配置后默认选择待 UI 验收 |
| FR-04 拖放派发 | AgentTargets → 同一 dispatch 命令 | 命令边界已测；真实指针拖放待验 |
| FR-05 会话到任务／空行关联 | linkSession/createTaskFromSession；空行或自由文字落点；确认换绑保留原历史 | 业务回归及真实指针／菜单六项验收通过；新任务原文保留、换绑取消/确认/原历史、刷新恢复，见 `output/linking-qa/review.json` |
| FR-06 任务到已有会话 | SessionEntry 接受任务拖入，TaskRow 提供选择已有会话，统一换绑确认 | 命令和换绑子树/时间段回归通过；任务反向拖入已有会话、菜单关联及确认换绑已通过真实 UI 验收 |
| FR-07 多任务并行 | 每次 run 独立 ID；跨项目事件路由 | 业务替身并行与隔离已测；真实进程并行待验 |
| FR-08 同任务多会话、继续、重派 | 原 sessionIds；Runtime control/retry | 受理未知不盲重发，失败后保留历史；UI和真实恢复待验 |
| FR-09 状态、真实步骤 | Runtime flat status/step/usage 事件 | 已测；无总量只保存实际动作，不造百分比 |
| FR-10 父子执行 | 子 Agent → 独立 source/attempt；业务父任务关联 | 嵌套来源、结果及 queued/running/paused/cancelled/failed/done 全状态投影/统计已测；各工具真实子代理事件覆盖分别验收 |
| FR-11 每轮持久回流 | Driver 只在 turn end 发最终 reply；领域存 Round | 业务去重已测；真实持久化重启由 native 测试验收 |
| FR-12 准确回源 | source connection/session/child/request ID；prepareSourceSession 精确只读导入外部会话 | adopt 不发 prompt、不改变归档状态及源身份已测；Codex 实际续聊保持同 sourceSessionId，其他工具分别验收 |
| FR-13 Now 拖排、移出、恢复 | nowQueue；默认 3 项、全量独立排序、隐藏/恢复 | 领域回归和实际鼠标／键盘／刷新验收通过；`output/now-logs-qa/review.json`，不改变源执行生命周期 |
| FR-14 7 天扫描 | Runtime scan 与项目连接/autoJournal | 业务去重与不派发已测；四目标真实扫描范围由适配器验收 |
| FR-15 跟踪关闭／恢复 | setTracked；syncTrackedSources 按项目绑定独立扫描 | 业务跨项目周期同步不切换活动项目通过；main 每 60 秒触发；真实外部增量覆盖按工具验收 |
| FR-16 主力、历史、pin | AgentRoster/setTracked/toggleStar/togglePin | 原操作存在；跨日真实数据和上限交互需 UI 验收 |
| FR-17 搜索清空 | 统一项目索引与准确结果位置 | 29 项搜索/统计边界回归通过；界面焦点和清空位置待验 |
| FR-18 今日指标和活动条 | 真事件时段、墙钟并集、用量增量 | Timeline 和 Runtime 测试通过；未知覆盖不补造 |
| FR-19 14 天协作分钟 | Runtime 依据真实时间段生成 daily14 | 数据实现已补；多日真实覆盖与堆叠图 UI 待验 |
| FR-20 Agent 微图 | 同一 daily14/usage 进入 Agent 卡 | 数据来源已接；未知项与零值区分待 UI 验收 |
| FR-21 最近会话 | 用户后续改为最近主任务 | 按用户覆盖，不恢复已删除的旧会话导航 |
| FR-22 日程编辑 | dailySchedule、ScheduleSheet、跨项目 taskId/date | 领域和 UI 操作、跨项目定位、多日计划、四档宽度、刷新持久均通过；`output/daily-qa/review.json` |
| FR-23 弹性、容量、重排 | scheduleCapacity 按可用时段、当前时间、跨项目真实时间计算；固定/有实际记录的安排锁定；用户预览后原子应用弹性改排 | 日界/过去日期/DST/固定冲突/连续空档不足/旧预览拒绝通过；真实 UI 预览、应用、390px、刷新持久通过：`output/schedule-capacity-qa/review.json`。超载保留原安排，手动调整日期/时长；不会自动执行任务 |
| FR-24 实际开始／暂停／结束 | setPlanTimer + 人工 manualActual + Runtime 区间 | 日程专项与 Runtime 事件水位通过 |
| FR-25 螺旋双向联动 | Spiral/planIncludesInterval/TaskScheduleButton | 数据联动已测；真实点选和滚动定位待 UI 验收 |
| FR-26 6 秒回放 | P1 | 未作为本次 P0 完成声明 |
| FR-27 系统菜单栏 | Electron Tray（root 负责） | 必须真实 macOS/Windows 系统入口验收，页面模拟不算 |
| FR-28 等待提醒及处理 | source requests 字典 + control +精确 requestResolved | 并行子权限、先答旧请求、拒绝失效 ID、重启清理旧 wire 请求已测；源端实际权限及系统通知待真实工具验收 |
| FR-29 三档记录和历史折叠 | SessionLog；摘要／标准／详细密度；根会话、子 Agent、子任务详情与 observed 共用；公开回执按精确 source 分流 | 三档显示、切换保留历史展开、刷新保存及无新增执行的领域与 UI 验收通过；`output/now-logs-qa/review.json`。新增根/子/兄弟隔离回归；observed 可看已同步轮次并按需只读导入源工具记录。主任务/子任务进度不受密度隐藏 |
| FR-30 完成和归档 | turn end 不完成；archive 且人工必需子项完成才收尾 | 已有专门回归；取消不当作成功 |
| FR-31 外部会话落日记 | scan → Session(origin observed) → journal block | 替身边界通过；适配器真实发现与覆盖待验 |
| FR-32 合并待办 | linkSession 去掉独立行，保留 Session | 原命令已实现；双向绑定及换绑历史见 FR-05/06 |
| FR-33 每轮末句和全文 | Round 原始最终文本 + UI 摘要 | Driver 与业务契约通过；每工具实际 turn-end 需验 |
| FR-34 颜色、计划实际同轴 | Agent.color、Timeline、Spiral | 日程/区间算法通过；日终多项目图表待 UI 验收 |
| FR-35 Agent 讨论和结论 | startDiscussion；带 sourceRef 的结构化结论 | 真实 Codex 两轮方法讨论已通过：先问材料/成果，再确认 5/20/5 分钟人工阅读及 100 字笔记；结论自动回写、采用进入方案、归档讨论不完成任务，见 `output/native-runtime/codex-discussion.json` |
| FR-36 可编辑方法 | PlanDocView/采用逻辑保留 userEdited | 原采用回归；真实 Agent 结论不直接覆盖用户正文 |
| FR-37 草稿及部分采用 | generateDrafts/addDraftsIn；加入不派发 | 原领域实现与版本幂等；复杂真实方法拆分质量待验 |
| FR-38 人工/Agent/未安排 | 独立 owner、人工成果和计时 | 原手动成果/项目测试通过，Runtime 不伪造人工 Token |
| FR-39 局部讨论/递归拆解 | startDiscussion 支持 planId/itemId/scope | 范围上下文固定、历史带来源；完整嵌套 UI 待验 |
| FR-40 混合父级/子 Agent | 独立 WorkItem、Attempt、Session，全部必需子项检查 | 业务测试通过；主任务自有验收保持人工完成入口 |
| FR-41 成果和来源 | completedResults 聚合人工发布、归档 Agent、子 Agent 末轮 | 成果去重/分支/人工输出测试通过；实际文件由 native 附件验收 |
| FR-42 版本/来源/幂等 | immutable dispatch context，adopted version，原采用保护 | 业务替身和既有来源测试通过，真实编辑冲突回路待验 |
| FR-43 修订影响 | P1 | 未作为本次 P0 完成声明 |
| FR-44 规划/执行统计回归 | purposeMetrics 与 StatsPanel 分析／执行／人工；24 小时时轴 | 分组、区间并集、跨日裁剪、源用量去重、未知用量保留回归通过；四目标综合真实验收仍待齐备 |

## P0 不能被接口抵销的缺口

1. 四目标必须分别验收 Claude Code、Codex、WorkBuddy、DeepSeek Harness 的安装/连接、派发、状态、实际用量、回源、历史与子代理能力。现阶段具体支持范围须以 `scripts/runtime` 真适配器和本机实测记录为准。
2. FR-05/06 双向关联、自由文字/空白处转任务、换绑历史和刷新恢复已通过领域及真实 UI 操作验收。FR-13/29 已补齐领域和真实 UI 操作验收，UI 夹具明确标注，未当作 Agent 真运行证据。
3. 真实系统托盘、多轮方法讨论及两平台安装后的干净启动/恢复是发布门槛。macOS Electron 干净启动、桥接鉴权、配置重启与真实 Codex 两轮方法讨论/结论采用已有证据；其他工具、Windows 本机安装验收另记。
4. PRD 中旧导航与最新用户意见冲突时，以最新要求为准：项目维度总览、主任务最近记录、三栏成果、圆形头像设置、移除顶部汇总和 mock 数据。

## 本次本地证据

`node scripts/test.mjs` 在允许本机端口监听的验证环境重跑：16 组 TypeScript 领域回归、29 项搜索/统计边界、59 项 Node 连接/子进程协议/磁盘测试全部通过，未跳过 HTTP 鉴权测试。`tsc --noEmit` 通过。协议夹具和原始文件夹具测试不等于实际厂商账号模型调用。

实际运行证据：`output/native-smoke.json`（macOS arm64 Electron 0.5.0，干净启动、真实窗口渲染、授权 200／未授权 401）；`output/agent-setup-qa/review.json`（真实 Codex 协议测试、项目连接保存、Electron 重启恢复）；`output/native-runtime/codex-live.json`（同 sourceSessionId，首轮 21,482 token、网络重试后第二轮 45,141 token、停止和归档状态）。日程与 Now/日志 UI 证据见对应行。

`output/native-runtime/codex-discussion.json` 记录第二次独立真实验证：同一 Codex 源会话，首轮 22,460 token、两轮累计 46,067 token；澄清 → 完整人工阅读方法 → 自动结论回写 → 显式采用，均通过。测试只创建 1 个讨论 run、业务任务没有执行会话，讨论归档不等于任务完成。
