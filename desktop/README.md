# QuanDeck 桌面安装包

桌面版内置前端和本地 Agent 连接服务，不依赖用户另行运行开发服务器。连接服务只监听回环地址，每次启动生成新的配对凭证。

## 安装

- **macOS**：打开对应芯片架构的 `.dmg`，把 QuanDeck 拖到 Applications，再从应用程序目录启动。
- **Windows x64**：运行 `QuanDeck-0.3.0-win-x64-Setup.exe`，选择用户范围和安装目录，按向导完成安装。卸载入口位于 Windows「设置 → 应用」；卸载保留用户数据。

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

Mac 检查会验证 DMG、Applications 链接、包签名和版本，将应用拷贝到临时安装目录，检查页面渲染与本地连接服务认证，最后移除临时安装。支持传入另一个 DMG 路径。

Windows 检查仅用于一次性的 CI 虚拟机，避免改变已有安装的注册信息：

```powershell
./desktop/check-windows-install.ps1
```

它依次执行静默安装、启动检查、静默卸载与用户数据保留检查。检查结果分别写入 `output/mac-install-check-*.json`、`output/windows-install-check.json`。启动检查使用独立的数据目录，不连接用户的 Agent、不派发任务。

## 自动构建

[desktop-installers.yml](../.github/workflows/desktop-installers.yml) 在 `main` / `codex/**` 推送、标签推送、面向 `main` 的 PR 或手动触发时运行：

- macOS 15 Apple Silicon：生成并安装验证 arm64 DMG。
- macOS 15 Intel：生成并安装验证 x64 DMG。
- Windows：生成 NSIS 安装向导并执行原生安装、启动及卸载检查。

每项先运行应用测试、TypeScript 校验和前端构建。工作流上传安装包、哈希清单与验证记录作为 Actions artifacts，不自动发布 Release。只有成功运行对应平台检查后，才能声称该平台安装已验证。

参考：[electron-builder 多平台构建](https://www.electron.build/v26/docs/features/multi-platform-build/)、[NSIS](https://www.electron.build/v26/docs/nsis/)、[DMG](https://www.electron.build/v26/docs/dmg/)、[GitHub 托管运行器](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。
