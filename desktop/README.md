# QuanDeck 桌面安装包

桌面版内置前端和本地 Agent 连接服务，不依赖用户另行运行开发服务器。连接服务只监听回环地址，每次启动生成新的配对凭证。

## 安装

- **Mac Apple Silicon**：打开 `QuanDeck-0.4.0-mac-arm64.dmg`，把 QuanDeck 拖到 Applications，再从应用程序目录启动。
- **Mac Intel**：使用 `QuanDeck-0.4.0-mac-x64.dmg`，安装方式相同。
- **Windows x64**：运行 `QuanDeck-0.4.0-win-x64-Setup.exe`，选择用户范围和安装目录，按向导完成安装。卸载入口位于 Windows「设置 → 应用」；卸载保留用户数据。

首次启动显示“先建一个项目”，没有预置项目、任务或 Agent。新建项目后即可记录任务、拆分子任务、保存方法和人工成果；使用 Agent 时再到右上角头像中的设置添加配置。

## 本地数据

项目、任务、方法、成果文本和日程保存在应用本机存储中，各项目分别保存；Agent 连接配置可供多个项目使用。成果附件保存在本机 IndexedDB，每个文件上限 25 MB。浏览器预览与桌面应用使用不同的存储来源，数据不会自动互通。

右上角头像 → 数据 → 导出全部项目，可下载项目 JSON。附件需从成果中分别下载，JSON 不包含附件文件内容。应用升级继续使用已有本机数据；首次启动检查专门使用全新的临时用户目录，不会清空正常使用的数据。

当前构建没有 Developer ID 公证或 Windows Authenticode 证书。Mac 包使用本地 ad-hoc 签名保持包内完整性，Windows 安装程序未签名；首次打开时操作系统可能要求额外确认。正式商用分发需要发布者自己的签名证书及公证凭据。

## 构建

需要 Node.js 22.12+、pnpm 10；macOS 包需要在 Mac 上构建。打包依赖独立安装在 `desktop/node_modules`。

```sh
pnpm install --frozen-lockfile
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --prefix desktop --no-audit --no-fund
pnpm build
node desktop/package.mjs --mac --arch=arm64
node desktop/package.mjs --mac --arch=x64
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

它依次执行静默安装、启动检查、静默卸载与用户数据保留检查。检查结果分别写入 `output/mac-install-check-*.json`、`output/windows-install-check.json`。启动检查使用独立的数据目录，验证没有项目、Agent 身份和 Agent 连接配置，结果记录 `cleanStartup: true`；检查不登录用户的 Agent、不派发任务。

## 自动构建

[desktop-installers.yml](../.github/workflows/desktop-installers.yml) 在 `main` / `codex/**` 推送、标签推送、面向 `main` 的 PR 或手动触发时运行：

- macOS 15 Apple Silicon：生成并安装验证 arm64 DMG。
- macOS 15 Intel：生成并安装验证 x64 DMG。
- Windows：生成 NSIS 安装向导并执行原生安装、启动及卸载检查。

每项先运行应用测试、TypeScript 校验和前端构建。工作流上传安装包、哈希清单与验证记录作为 Actions artifacts，不自动发布 Release。只有成功运行对应平台检查后，才能声称该平台安装已验证。

[publish-installers.yml](../.github/workflows/publish-installers.yml) 通过手动触发发布原始构建产物：核对源码 SHA、包哈希和三平台原生安装记录；0.4.0 起还要求通过 `cleanStartup`。发布不会把新增发布流程的提交误作为安装包源码版本。

参考：[electron-builder 多平台构建](https://www.electron.build/v26/docs/features/multi-platform-build/)、[NSIS](https://www.electron.build/v26/docs/nsis/)、[DMG](https://www.electron.build/v26/docs/dmg/)、[GitHub 托管运行器](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。
