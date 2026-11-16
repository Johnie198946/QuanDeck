# Windows：逐步连接 DeepSeek Harness

适用对象：已有 DSH / xLink DSH Desktop，准备接入 QuanDeck。本说明依据 QuanDeck 0.7.1 的连接流程和 DSH `0.2.0-rc.2` 官方启动器；企业分支是否兼容，需要以目标机器的结果判断。

“已安装”只说明找到了程序。“已连通”要求 SDK 初始化后，模型在约 60 秒内完整回复一条独立 hello 消息。网页能打开、Desktop 能聊天或 CLI 能输出版本号，都不能单独证明第二步通过。测试会使用源工具的账号和模型，可能产生一次模型用量，不会派发业务任务。

## 第一步：确认使用哪个 DSH

打开现有 DSH Desktop，在应用菜单选择 **Manage dsh Command… → Install / Repair**。没有该菜单时，向该企业版本的管理员索取 CLI / SDK 入口；先保留现有企业安装和账号配置。[官方 Desktop 命令注册说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/desktop/README.md#terminal-command)

从开始菜单新开 **PowerShell**，依次运行：

```powershell
where.exe dsh
dsh --version
Get-Command dsh -All | Select-Object CommandType, Source
```

预期看到程序路径和版本号。Desktop 自带的入口通常以 `resources\runtime\cli\bin\dsh.cmd` 结尾。若输出多个入口，选择当前 DSH Desktop 安装目录里的那一个，而不是另一套 npm 安装。

如果 PowerShell 提示脚本策略阻止 `dsh.ps1`，可以使用 `where.exe dsh` 查到的完整 `.cmd` 路径检查；不需要先改变系统执行策略。将下方路径替换为实际结果，保留 `&` 和引号：

```powershell
& 'C:\实际安装目录\resources\runtime\cli\bin\dsh.cmd' --version
```

CLI 路径不是 `powershell.exe`、`pwsh.exe`，也不是 DSH 的浏览器地址。Desktop 的 `.cmd` 会使用安装包自带的 Electron/ASAR 运行环境，无需另装 Node。QuanDeck 只识别已验证的启动器结构；企业版修改过启动脚本时，需要单独适配。[官方启动器](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/desktop/cli/dsh.cmd)

## 第二步：确认源工具本身可回复

回到现有 DSH，选择可用模型。新开对话，发送“只回复 hello，不调用工具”。如果这里已经失败，先处理 DSH 的模型服务或网络问题；使用账号的服务再检查登录状态。

企业网关使用 **Base URL + API Key** 时，不需要额外登录 DeepSeek 账号。继续在 DSH 的“设置 → 模型配置”管理企业网关和凭据。GUI 能回复，说明该 GUI 当前 profile 和会话的模型配置有效，尚不能证明 SDK 使用了同一份路由。旧版 QuanDeck 的“请确认 Agent 的登录和模型配置”是统一失败提示，并不等于检测到了账号未登录。

不要把 API Key、Cookie、配对码或完整配置文件粘贴到诊断消息里。

## 第三步：在 QuanDeck 填写连接信息

完全退出 QuanDeck（检查系统托盘），再打开，以便读取刚注册的命令路径。先创建或选择一个 QuanDeck 项目，然后依次进入：

**右上角头像 → 本地 Agent → 配置 Agent → DeepSeek Harness → CLI / SDK → 连接项目**。

| 字段 | 填写方式 |
| --- | --- |
| CLI 路径 | 选择第一步确认的 `dsh.cmd`；用“选择程序”避免手工路径错误 |
| Node.js 路径 | DSH Desktop 自带的 `.cmd` 留空；只有独立 npm / JavaScript 入口才可能需要指定系统 Node |
| 本地项目路径 | 用“选择文件夹”选择希望 Agent 工作的真实本机文件夹 |
| 配对码 / 服务地址 | 桌面版自动管理，不填写 DSH 的网页地址 |
| Provider / Model ID / API Key | 不在 QuanDeck 填写；沿用 DSH 的 SDK 配置 |

点击一次 **测试连接**，等待结果。成功后再点击 **保存配置**。重新选了程序或文件夹，需要重新测试。

## 第四步：按失败阶段排查

本次开发增加了分阶段状态和可复制诊断摘要。尚未更新的安装包可能仍只显示“未连通”；这时先提供第一步的路径、版本和界面原提示，不推定故障原因。

| 阶段 / 诊断 | 下一步 |
| --- | --- |
| 本机服务未就绪 `LOCAL_SERVICE` | 完全退出并重新打开 QuanDeck；桌面版无需另运行 bridge 或改端口 |
| 未找到程序 `CLI_NOT_FOUND` / 入口未验证 `CLI_LAUNCHER` | 核对完整 `dsh.cmd` 路径；运行该路径的 `--version`；企业启动器变种需要适配 |
| 无法读取默认模型 `SDK_MODEL` | 检查第五步的 `sdk` profile；Desktop 当前模型可能没有写入 SDK 配置 |
| SDK 配置未通过 `SDK_UNSUPPORTED` | 核对真实 CLI 版本与企业 SDK 协议；只有 GUI 的版本需要厂商提供 API / SDK |
| 隔离检测未通过 `ISOLATION_UNSUPPORTED` | SDK 已启动，但本次只读 hello 的插件配置不能验证；需要核对企业插件和配置结构，不能靠关闭检查宣称连通 |
| 回复超时 `TIMEOUT` | 若第一阶段已通过，检查 SDK 所用模型和网络；不要连续点击产生重复尝试 |
| 未收到有效回复 `MODEL_REPLY` | 检查 SDK 的登录、模型路由及实际返回格式；仅凭这一提示无法确定具体根因 |

诊断摘要只包含工具、CLI 版本、失败阶段和固定诊断代码。不包含凭据、用户配置正文或源程序 stderr。

## 第五步：区分 Desktop / Web 与 SDK 的配置

QuanDeck 启动的是 **`dsh sdk`**，读取 `sdk` profile 的默认模型。DSH Desktop、Web 和 SDK 有不同的 profile；仅在 Desktop / Web 中添加企业模型或切换当前模型，不保证 `sdk` 能使用相同路由。

DSH 的配置按“内置 bundle → 当前 profile → 全局 home 配置 → 本次启动 patch”合成。需要由 DSH 或企业管理员确认：

1. `sdk` profile 中有可用的模型适配器和凭据引用。
2. SDK 默认模型的 provider / model 对应真实存在的模型。
3. 默认选择是可读取的明确值；动态表达式、多个默认模型或被禁用的默认项不能被 QuanDeck猜测。
4. 企业插件结构能用于独立、无业务工具的 hello 检测。

不要整体覆盖 `profiles\sdk\cordis.patch.yml`，也不要把 Desktop 的整个配置文件复制过去；其中可能包含只适用于桌面的插件。需要调整的是目标版本实际使用的模型路由与默认选择。[官方 profile 合成规则](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/cli/README.md#profiles) · [模型设置说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/docs/user/guide/providers.md)

`dsh sdk --dump-config` 可能输出凭据相关配置；不要将其全文发到聊天中。第一轮排查只需 QuanDeck 版本、第一步的路径/版本输出和诊断摘要。如果路径中有个人信息，可先遮盖用户名。

### 企业网关：只输出配置差异摘要

当 DSH GUI 已能回复、QuanDeck 仍失败时，可在第一步确认的同一 PowerShell 中粘贴下方整段。提示输入时，只在本机填写网关的**主机名或 IPv4 地址**，例如 `gateway.example.com`；不填 `https://`、端口、路径或 API Key。最后只分享三行结果。

这段命令将配置正文保留在临时变量中，不显示配置、URL、凭据或源程序 stderr，也不发起模型请求。**它不是严格零写入操作**：官方 rc.2 的导出流程会刷新 DSH 自动生成的 `cordis.yml`；如果 SDK profile 尚不存在，还会生成初始 profile 文件。它不改写已有的用户 `cordis.patch.yml`。[官方导出实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/cli/src/dump-config.ts) · [profile 初始化实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/cli/src/profile-boot.ts)

```powershell
& {
  $ErrorActionPreference = 'SilentlyContinue'
  $dshCli = Get-Command dsh.cmd -ErrorAction SilentlyContinue
  if (-not $dshCli) { 'DshCommandFound=False'; return }
  $dshHost = (Read-Host '输入网关主机名或 IPv4（不要填 API Key）').Trim()
  if ($dshHost -notmatch '^[A-Za-z0-9.-]+$') {
    'GatewayHostInputValid=False'
    return
  }
  try {
    $dshDump = (& $dshCli.Source sdk --dump-config 2>$null | Out-String)
    $dshCode = $LASTEXITCODE
    if ($null -eq $dshCode) { 'ConfigDumpStarted=False'; return }
    [pscustomobject]@{
      DumpExitCode = $dshCode
      DefaultModelPluginCount = if ($dshCode -eq 0) {
        ([regex]::Matches($dshDump, '(?m)^\s*(?:-\s*)?name:\s*[''" ]*@deepseek-ai/dsh-agent-default-model[''" ]*\s*$')).Count
      } else { $null }
      GatewayHostSeenInSdk = if ($dshCode -eq 0) {
        $dshDump.IndexOf($dshHost, [StringComparison]::OrdinalIgnoreCase) -ge 0
      } else { $null }
    }
  } catch {
    'ConfigDumpStarted=False'
  }
}
```

若存在多个 `dsh.cmd` 入口，应将 `$dshCli.Source` 换成第一步确认的完整入口路径，并用单引号包住。不要将完整配置或错误日志作为补充输出。

- `DumpExitCode = 0`：配置合成命令成功，不代表 SDK 模型调用成功。
- `DefaultModelPluginCount = 1`：文本中出现一个默认模型插件；尚未验证是否启用、provider / model 是否正确。
- `GatewayHostSeenInSdk = False`：SDK 合成文本没有出现输入的主机名，值得检查 GUI 与 SDK 的配置差异；使用环境变量、动态表达式或不同主机名时，也可能得到 `False`。
- `GatewayHostSeenInSdk = True`：只能说明主机名出现在配置文本中；不证明它属于当前默认模型，也不证明密钥有效或网关可用。

这些结果用于决定下一步核对哪层配置，不能单独确定根因。企业版本修改了配置结构或命令行为时，需结合厂商说明确认。

## 在 QuanDeck 中复用已有模型配置

适用于包含“使用已有模型配置”入口的 QuanDeck 版本。旧安装包没有该入口时，继续使用上面的诊断步骤。

1. 新建连接时，进入 **配置 Agent → DeepSeek Harness → 连接项目 → 使用已有模型配置**。已有连接可在 **设置 → 本地 Agent** 的 DSH 配置下点击同名入口。
2. 检查列出的来源和默认模型。单一可用来源可以预选，仍需点击 **使用此模型并检测**；存在多个来源时由你选择，QuanDeck 不按名称或修改时间猜测。**尚不能确认 SDK 模型路由** 表示目前无法确认可复用的路由，不表示需要登录账号。
3. 检测先启动 CLI / SDK，再等待独立 hello 回复；全部通过后才标记已连通。新连接还需点击 **保存配置**。已有连接检测通过后原位替换，保留项目绑定；失败时原配置保留。检测可能产生一次模型用量。
4. 要恢复复用前的连接，点击 **撤销模型复用**，然后重新 **测试连接**。恢复的是上一次连接配置，可能是 SDK 原配置，也可能是之前选过的其他来源；历史任务保留。

QuanDeck 读取当前 DSH home 下的 `profiles`，兼容 `desktop`、`web`、`xlink-desktop` 等 profile 名称，不把企业版名称写死。目录名称本身不代表兼容：来源还需要声明已知 DSH 基础 bundle，默认模型和对应路由必须能明确解析。官方 rc.2 Desktop 使用包含 `@deepseek-ai/dsh-base` 的 Web 模板初始化 profile。[官方 Desktop 初始化实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/desktop/src/project-manager.ts)

本次复用只生成 **QuanDeck 当前连接的模型配置快照**，通过启动参数应用，不修改 DSH 的 SDK、桌面或全局配置，也不复制整个 profile、插件、API Key 或凭据文件。创建快照时保留 SDK 已有的其他提供方；模型请求仍由 DSH 根据原凭据引用取值。来源与 SDK 必须使用同一 DSH home 下的兼容凭据设置，QuanDeck 不会迁移其他账号或目录中的密钥。

快照不是持续同步。DSH 中更换了网关、模型或路由后，使用 **重新读取**，重新选择并检测；来源在读取与应用之间变化时，QuanDeck 会要求重新读取。当前连接使用的是已确认快照，快照缺失、被修改或路径不符合要求时会拒绝启动，不会静默回退到其他模型。

当前自动复用范围是明确配置的 pi-ai 模型路由，以及 DeepSeek API-key 适配器的明确配置。来源需要有协议（pi-ai）、Base URL、凭据引用和包含所选模型的模型列表。依赖隐式模型目录、动态表达式、内联密钥、自定义请求头、额外凭据存储或未知企业模型适配器的配置会给出不支持原因；不会执行表达式、复制插件或改写原配置来绕过检查。配置可读取只代表能够生成快照，真实可用性仍以 SDK 握手和模型回复为准。

此功能已用隔离配置与协议测试验证；**尚未在用户的 Windows xLink DSH 安装及企业网关上完成真实验证**。企业版本的 home、manifest、适配器或凭据规则若有改动，可能仍需要针对该版本适配。

## 连接成功后的版本边界

DSH `0.2.0-rc.2` 支持新任务、公开回复、实际用量与同一存活进程内续聊；停止或退出后不能恢复旧 SDK 会话。QuanDeck 不能接管已有 GUI 对话，也不能替 rc.2 回传外部权限批准。点击回源会打开 DSH 界面，由用户选择会话。连接成功不改变这些协议边界。
