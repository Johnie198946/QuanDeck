# QuanDeck 桌面版

## 使用

- macOS：打开对应芯片的 `.dmg`，将 QuanDeck 拖入“应用程序”。
- Windows x64：运行 `QuanDeck-0.3.0-win-x64-Setup.exe`，按安装向导完成。
- 进入“我的 → 配置 Agent”。桌面版自动启动本机连接服务，选择项目文件夹后检测工具、测试连接并保存。
- 安装与登录教程见 [本地 Agent 配置](local-agent-setup.md)。

任务、方法、结果和日程保存在应用的本机存储中；“我的 → 导出 JSON”可导出当前工作台。首次显示的是读书笔记示例项目，示例状态切换位于“我的 → 示例体验”。连接工具不会把示例任务自动转成源端真实执行。

## 分析到执行

1. 在任务页写“我要去芭提雅”，选择“交给 Agent 讨论”；已有任务使用“先分析”。
2. 选定 Agent 与项目目录。“在 Agent 中开始分析”会打开源工具的交互终端。工具未安装时先完成配置教程。
3. 在源工具中多轮沟通行程天数、交通、玩法、照片与最终笔记。QuanDeck 只保留结论。
4. 把本轮结论记录回来，采用到任务方法，再整理为子任务。每个子任务可交给自己或 Agent，也可继续细分。
5. 总览点击任务，查看任务树、采用的方法和执行结果。未完成的过程显示为执行动态，不计作完成结果。

当前讨论结论通过“记录 Agent 结论”录入。外部会话的自动回写、Token 与执行事件由 `WorkdeckDataSource` / Runtime 适配器提供；本机连接服务尚不实现完整持续同步。Codex 已实现登录与会话元数据校验、准确会话回源和交互讨论打开；其他工具按检测到的实际能力启用。WorkBuddy、DSH 使用手动协作。

## 构建

需要 Node.js 22.15 或以上、pnpm。

```sh
pnpm install
pnpm desktop:setup
pnpm exec tsc --noEmit
pnpm test
pnpm desktop:package
```

也可以运行 `pnpm desktop:mac` 或 `pnpm desktop:windows`。默认目标为 macOS arm64 和 Windows x64。安装包位于源码根目录的 `output/installers`，`output/desktop` 仅保存中间产物。Electron 运行时可由打包器下载，或放到 `output/electron-runtime`；本次缓存均按 Electron 官方 SHASUMS256.txt 校验。

应用使用稳定的 `quandeck://app` 本地页面来源、隔离的预加载接口、随机环回端口和每次启动的随机配对码；页面不能直接调用 Node.js。文件夹选择与连接信息仅暴露给本应用窗口。默认不向非本机地址开放连接服务。

## 安装验证

原生安装、启动、移除与本地服务认证由 GitHub Actions 执行，结果随构建上传。检查脚本、签名状态和具体流程见 [桌面安装包说明](../desktop/README.md)。Agent 的真实登录、推理和用户会话不属于安装烟雾测试范围。
