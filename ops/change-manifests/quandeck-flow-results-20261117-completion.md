# quandeck-flow-results-20261117

- task_id: quandeck-flow-results-20261117
- status: COMMITTED
- branch: codex/quandeck-flow-results-20261117
- worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-flow-results-20261117
- commit SHA: a7dba5427be561125413bf367b122fe7d8e5ea8f (implementation; this manifest is recorded in its following documentation commit)
- remote/ref/SHA: 未执行；父任务负责合并、推送与发布。
- server_before: 不适用，桌面产品子任务，无服务器部署。
- server_after: 不适用，未部署。
- health_check: pnpm exec tsc --noEmit、pnpm build 通过。
- functional_check: pnpm test 通过（domain suites 和 234/234 Node tests）；isolated Chrome browser test 通过。
- rollback_point: 01e24ee09deaa5e9ddf804e572b23b0a2313c185；可由父任务 revert 本实现提交，无用户数据迁移。

## 目标与交付

成果页增加可沉浸展开的 HTML 图文阅读器；普通成果中的图片也有显式预览入口。保存的成果附件按项目、成果、附件 ID 解析，原始路径不从渲染器接收。现有图片、视频、PDF、Word、Excel 预览复用到成果附件。默认不访问外部图片，Google Maps 官方 embed 从被动 HTML 文档中分离后按需加载。

HTML 使用标签和属性白名单重建、CSP 禁止脚本与连接，并放入不允许脚本或同源权限的 iframe。独立 Google 官方跨域地图 iframe 只接受精确主机与 maps/embed 路径。文件选择、元数据和历史依旧来自既有项目快照，不另建成果状态真源。

成果详情采用主文档与上下文侧栏；无交付时直接展示进展及子任务。大窗扩展内容宽度，小窗单列；扩大窗口后短回弹动效遵守 prefers-reduced-motion。沉浸弹窗使用原生 dialog，支持 Escape、焦点恢复与键盘约束。

## 开工 Git 盘点

- initial status: `## codex/quandeck-flow-results-20261117`，干净
- initial branch: codex/quandeck-flow-results-20261117
- initial HEAD: 01e24ee09deaa5e9ddf804e572b23b0a2313c185
- origin fetch/push: https://github.com/Johnie198946/QuanDeck.git
- worktree: 从该 HEAD 新建独立工作树；未覆盖其他任务工作树。完整五项盘点保存在本工作树 `output/results-immersive/git-before.txt`。

## 变更文件

- `desktop/app/attachment-preview.mjs`、`desktop/app/main.mjs`、`desktop/app/preload.cjs`
- `desktop/attachment-preview.test.mjs`
- `src/integration/desktop.ts`、`src/data/outputFiles.ts`
- `src/components/runtime/AttachmentPreview.tsx`、`HtmlPreview.tsx`、`sanitizeHtmlDocument.ts`、`attachment-preview.css`
- `src/components/results/ResultDocument.tsx`、`ResultsBoard.tsx`、`OutputPreview.tsx`、`useResultResize.ts`、`results-focus.css`
- `tests/immersive-results.browser.mjs`

## 校验证据

- tsc 与 build 通过；构建保留既有大 chunk 提醒。
- Node 附件测试 9/9（包含跨项目/跨成果/错误附件 ID、元数据不符、HTML 体积限制）。
- 全量测试首次在沙箱内因三个 localhost listen EPERM 失败；允许隔离本地套接字后完整通过，不修改这些测试逻辑。
- 隔离浏览器验证 1920、1440、1024、768、320；无文档水平溢出、无脚本执行、无附件外网请求、无 pageerror、弹窗 Escape 与焦点恢复正常。
- 测试注入 script、事件处理器、javascript 链接、file URL、SVG data URL、伪 Google 域、带凭据 URL、非地图 Google URL 均被清除。
- 真实用户攻略只读验证：10/10 图片加载；1440 与 390 截图已检查。原文件未修改。
- 本地证据：`output/results-immersive/tests.log`、`build.log`、`ui/checks.json`、`ui/*.png`、`real-guide.json`、`real-guide-1440.png`、`real-guide-390.png`（生成输出不入 Git）。

## 风险与未完成项

- HTML 里的脚本交互与任意嵌入默认不可用；这是被动文档预览，下载保留原文件。远程图片和 Google 地图需要用户点击加载；实际联网可用性取决于网络，浏览器回归不冒充 Google 实时路线验证。
- 仅支持文档内嵌图片或 HTTPS 网络图片；相对本地资源不绕过附件边界自动读取。推荐生成自包含 HTML。
- Word/Excel 沿用既有正文/表格预览，复杂 Office 排版请下载查看。
- 未安装到 /Applications、未触碰真实项目记录、未 push、未发布；由父任务统一集成与发布。
