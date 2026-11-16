# QuanDeck 桌面安装包

桌面版内置前端和本地 Agent 连接服务，不依赖用户另行运行开发服务器。连接服务只监听回环地址，每次启动生成新的配对凭证。

## 安装

- **Mac Apple Silicon**：打开 `QuanDeck-0.11.1-mac-arm64.dmg`，把 QuanDeck 拖到 Applications，再从应用程序目录启动。
- **Windows x64**：运行 `QuanDeck-0.11.1-win-x64-Setup.exe`，选择用户范围和安装目录，按向导完成安装。卸载入口位于 Windows「设置 → 应用」；卸载保留用户数据。

首次启动显示“先建一个项目”，没有预置项目、任务或 Agent。新建项目后即可记录任务、拆分子任务、保存方法和人工成果；使用 Agent 时再到右上角头像中的设置添加配置。

## 本地数据

项目、任务、方法、会话、成果和日程由桌面主进程保存在用户数据目录的 `workspace` 中，各项目分别保存。连接绑定具体项目和工作目录；同一源连接不能同时归属多个项目，以免会话重复。配置、用量、公开回复和真实附件均写入本机磁盘，SQLite 原子写入并保护不可变协作历史，旧 JSON 迁移时保留原件与恢复副本，附件每个上限 25 MB。首次升级读取旧版真实项目和配置，旧版 IndexedDB 附件仍可下载。浏览器开发预览使用自己的本地存储。

右上角头像 → 数据 → 导出全部项目，可下载项目 JSON。附件需从任务或成果中分别下载，JSON 不包含附件文件内容。数据设置中的工作台备份会保存 SQLite、附件和 SHA-256 清单，详见[协作实现说明](../docs/collaboration-design/implementation.md)。应用升级继续使用已有本机数据；首次启动检查专门使用全新的临时用户目录，不会清空正常使用的数据。

当前构建没有 Developer ID 公证或 Windows Authenticode 证书。Mac 包使用本地 ad-hoc 签名保持包内完整性，Windows 安装程序未签名；首次打开时操作系统可能要求额外确认。正式商用分发需要发布者自己的签名证书及公证凭据。

## 连接本地 Agent

打开头像 → Agent → 添加，选择工具、CLI 程序和项目目录。DeepSeek Harness 自动使用源 SDK 默认配置，无需填写 Provider 或 Model ID；Node 脚本可额外指定 Node 程序。桌面内部自动配对，无需手填本地端口或配对码。后台 hello 收发成功才允许保存，前端只显示是否连通；保存后的 Agent 可再次测试。

Codex、Claude Code 和 DeepSeek Harness 的执行通过官方协议／SDK 进行。沟通、权限和子会话在独立源执行窗口打开；主页面汇总公开回执和结论，不保存模型私有思考过程。关闭主窗口后仍可通过系统菜单栏／托盘查看；退出应用会停止本次进程，重启后恢复为暂停，由用户决定是否继续。配置截图与各工具限制见 [教程](../docs/local-agent-setup.md)。

设置 → 数据 → 清理旧安装包，仅匹配下载目录中低于当前版本的 QuanDeck DMG／EXE，不删除用户数据或其他应用。

## 0.11.1 修复

修复真实使用发现的大窗口方向页压缩、新任务粘贴截图缺失、原始需求直接作为长标题、并发上限阻塞讨论与拆解、子任务等待授权被隐藏、用户明确执行指令仍停留讨论、增量讨论丢失已声明输出结构。升级保留原始需求与不可变历史；交付槽修复追加新版本。旧任务标题通过配置的 Agent 后台归纳，失败保留原文且不覆盖手动改名。

实际 Agent 闭环验证与隔离安装检查分别记录，不以测试夹具证明全部业务可用。

## 0.11.0 更新

项目和任务方向提供大纲与正文；一次确认可开启按依赖自动执行。成果按预先声明的交付地图自动归位，缺失项保持空位，候选不会冒充人工认可。详细规则见[自动交付设计](../docs/goal-delivery-v0.11.md)。安装验证新增项目方向、持久化交付槽、候选/空位及详情阅读检查，使用隔离人工样例，不连接外部 AI。

## 0.7.4 更新

- 支持配置本机 Hermes ACP，验证通过后可派发、续聊、接收实际用量并作为同项目的派发前备用。外部会话发现及权限转发尚未接入。
- 分开本机连接检查和实际模型试发，可为 Codex 指定模型。Codex 网络重试会合并同一轮的重复提醒。
- 修复规划结论被包裹时的显示及多轮讨论提前关闭的问题。只见线项目的 Codex、Hermes 和人工成果回收、合并及导出已在本机验证。

## 0.7.2 更新

保留 0.7.0 的成果整合，以及后台待办分拣、项目记忆、协作记录和工作区备份，新增独立命名的自定义 Agent 配置、执行前连接检查、运行异常提醒与备用 Agent 接管。

连接配置中可以设置有序备用名单。默认先询问；明确开启后，仅在任务尚未发送时自动尝试备用。执行中转交需预览并确认，原进程停止后创建新执行，保留原用量与公开成果。模型和额度没有真实查询结果时保持待确认，不用程序握手冒充模型可用。连续三分钟未收到进展只提示关注，等回复或等权限不误报。

异常从右上角铃铛查看，桌面提醒可在设置中关闭。更完整的配置和接管步骤见 [本地 Agent 教程](../docs/local-agent-setup.md#7-自定义连接与备用-agent)。

## 构建

后续版本只支持 Apple Silicon Mac 和 Windows x64，不再构建或发布 Intel Mac 安装包。历史 Release 保持原样。

需要 Node.js 22.15+、pnpm 10；macOS 包需要在 Mac 上构建。打包工具安装在 `desktop/node_modules`，官方 Agent SDK 的生产依赖安装在 `desktop/app/node_modules`。构建先打包主进程业务核心，再复制前端和真实执行适配器；测试夹具不会进入安装包。

```sh
pnpm install --frozen-lockfile
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --prefix desktop --no-audit --no-fund
npm ci --prefix desktop/app --omit=optional --ignore-scripts --no-audit --no-fund
pnpm build
node desktop/package.mjs --mac --arch=arm64
node desktop/package.mjs --win --arch=x64
```

PowerShell 安装依赖时先运行 `$env:ELECTRON_SKIP_BINARY_DOWNLOAD='1'`，再执行 `npm ci --prefix desktop --no-audit --no-fund`。

安装包保存在 `output/installers/`，SHA-256 与版本记录在 `output/installer-manifest-*.json`。`output/desktop/` 是中间产物，不作为安装包分发。`--unpacked` 只生成中间产物；不传平台参数时默认构建 Mac arm64 与 Windows x64。

可通过 `QUANDECK_ELECTRON_CACHE` 指定已校验的 Electron ZIP 缓存目录；未配置时从官方下载运行时。固定 Electron 45.3.2、electron-builder 26.18.0。macOS 可以生成不含本机原生扩展的 Windows NSIS 安装程序，Windows 安装验证仍需在 Windows 中运行。

## 安装验证

```sh
node desktop/check-mac-install.mjs
```

Mac 检查会验证 DMG、Applications 链接、包签名和版本，将应用拷贝到临时安装目录，检查页面渲染、首次启动空态与本地连接服务认证，最后移除临时安装。支持传入另一个 DMG 路径。

Windows 检查仅用于一次性的 CI 虚拟机，避免改变已有安装的注册信息：

```powershell
./desktop/check-windows-install.ps1
```

它依次执行静默安装、启动检查、静默卸载与用户数据保留检查。检查结果分别写入 `output/mac-install-check-*.json`、`output/windows-install-check.json`。启动检查使用独立的数据目录，验证没有项目、Agent 身份和 Agent 连接配置，结果记录 `cleanStartup: true`；随后验证人工任务从上下文、候选提交到验收完成的闭环与数据库防篡改；检查不登录用户的 Agent，也不派发外部 AI 任务。

## 自动构建

[desktop-installers.yml](../.github/workflows/desktop-installers.yml) 在 `main` / `codex/**` 推送、标签推送、面向 `main` 的 PR 或手动触发时运行：

- macOS 15 Apple Silicon：生成并安装验证 arm64 DMG。
- Windows：生成 NSIS 安装向导并执行原生安装、启动及卸载检查。

每项先运行应用测试、TypeScript 校验和前端构建。工作流上传安装包、哈希清单与验证记录作为 Actions artifacts，不自动发布 Release。只有成功运行对应平台检查后，才能声称该平台安装已验证。

[publish-installers.yml](../.github/workflows/publish-installers.yml) 通过手动触发发布原始构建产物：核对源码 SHA、包哈希和Apple Silicon 和 Windows x64 两种原生安装记录；0.4.0 起还要求通过 `cleanStartup`。发布不会把新增发布流程的提交误作为安装包源码版本。

参考：[electron-builder 多平台构建](https://www.electron.build/v26/docs/features/multi-platform-build/)、[NSIS](https://www.electron.build/v26/docs/nsis/)、[DMG](https://www.electron.build/v26/docs/dmg/)、[GitHub 托管运行器](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

### 任务附件

创建任务或打开任务/子任务详情可上传资料，每项最多 20 个附件、每个不超过 25 MB。派发前将父任务和当前子任务的附件复制到绑定工作目录的 `.quandeck/attachments/<projectId>/<fileId>/`，Agent 接收可读取的绝对路径。准备期间若附件或连接改变，本次派发会取消并提示重试。移除附件解除当前任务关联，保留已保存文件和已派发副本，避免破坏历史会话；工作台备份包含这些文件。浏览器预览可本机保存与下载，没有文件交付能力的执行服务会拒绝带附件派发。
