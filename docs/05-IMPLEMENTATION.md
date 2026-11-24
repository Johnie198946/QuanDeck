# Codex 接手计划
基线：用户提供 QuanDeck-main-326bbbc.zip（326bbbcc210b4bff66e578703aa6bc27a0b78577）；以实际工作区最新源码为准。交接时仅核对了归档文件路径，未重新逐行审计或运行测试。以下映射是审查起点，不是已确认缺陷。

| 路径（src/ 下） | 审查方向 |
|---|---|
| App.tsx、components/layout/TopBar.tsx | 导航与共享搜索 |
| components/results/Dashboard.tsx | 首页与总览 |
| components/journal/Journal.tsx、Composer.tsx | 自由记录与选词扩写 |
| components/workspace/Workspace.tsx | 任务工作区与甘特 |
| components/projects/ProjectDialog.tsx | 三步创建 |
| components/deck/AgentTargets.tsx、ExecutionRail.tsx | Dock、跟踪 |
| components/results/ResultsBoard.tsx | 按任务成果 |
| components/settings/SettingsPage.tsx | 四类设置、保留连接机制 |
| data/ideaEngine.ts、projectMemory.ts、projectMemoryNotes.ts | 图谱、台账、记忆 |
| data/search.ts、repository.ts | 全局索引与共享数据 |

阶段（实施顺序，非任务优先级）：
1. P0 导航视觉与去重：六导航一致、无额外入口，原功能不丢。
2. P1 统一知识与记录检索：跨项目可找、原文可追溯、编辑后索引更新、迁移不丢数据。
3. P2 项目与研究甘特：三步确认、四区、行同步、拖拽撤销、依赖提示。
4. P3 分派跟踪验收：Dock 按需、单/多 Agent、人工任务、证据进度、成果版本和退回；不新增 runtime。
5. P4 图谱主动关联：跨记录对象和边可溯源，去重、冲突提醒、低价值静默。
6. P5 认知纠偏：历史保留、重大确认、否决抑制、长期事项提醒、权限验证。

第一轮只读审查：确认 git 状态/版本、项目结构、运行测试命令、数据 schema、连接与权限、现有实现和测试；按保留/修改/删除/新增/打通列出实际路径与依据，识别风险、迁移和回滚方案，提交计划等待用户确认，不改代码。不要根据旧文件名臆测实现。
每阶段维护开发台账（任务、状态、证据、变更文件、测试、阻塞、下一步），真实运行构建与测试，未运行标明；保护用户数据、未提交改动，不擅自删除。发现矛盾或不可行先问。

端到端验收：①生活记录链接→来源可查→连续研究自动回流，不自动创建项目；②碎片灵感→跨记录关联→依据可查→重要创意提醒；③领导交办→首页优先→人工确认任务→交付与验收；④软件项目→三步创建→研究→拖给多 Agent→真实跟踪→对比选择/退回→台账；⑤历史冲突→证据判断→用户确认→保留旧版，否决不重复提醒。逐项记录实际结果，不把模拟当通过。界面和输出均检查 ELI5。
