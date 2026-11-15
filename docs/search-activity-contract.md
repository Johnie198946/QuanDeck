# 搜索与项目执行汇总接口

本轮前端入口：顶部搜索（⌘K / Ctrl+K）与“运行 / 等我”。未完成的“任务”导航、项目切换空入口已删除。界面默认一行，不显示各类占位信息。

## 搜索

`src/data/search.ts` 是完整 TypeScript 请求、响应和导航目标定义。

配置 `VITE_WORKDECK_API` 后 UI 调用 `GET {base}/v1/search?projectId=…&q=…&limit=12&kinds=…&cursor=…`；未配置时索引当前 Snapshot，不会冒充已经搜索其他日期。

```json
{
  "items": [{
    "id": "work:task-a:w-ui",
    "kind": "work",
    "title": "制作搜索界面",
    "snippet": "搜索框已放在笔记列表顶部，正在做结果高亮。",
    "date": "2026-11-15",
    "score": 94,
    "target": {"taskId": "task-a", "itemId": "w-ui"}
  }],
  "total": 1,
  "scope": "project_index",
  "indexedAt": "2026-11-15T12:14:00Z"
}
```

- `kind`: task / work / session / journal / plan / conclusion。
- `target` 可包含业务 taskId、itemId、sessionId、planId、sectionId、blockId、conclusionId。不能用推测的深链接取代准确标识。
- `scope`: current_snapshot 或 project_index。后端必须按当前项目和用户访问权限过滤。
- 精确、前缀、包含匹配优先；大小写、空格、标点不敏感；支持有间隔的关键词及小量错字 / 英文换位。多个空格分隔词使用 AND。
- 标题、日记全文、子任务、会话轮次回复、方案正文、讨论结论均可搜索。增改删随快照更新，不保留已删除条目。
- 跨日期结果先调用数据源 `navigateToDate(date)` 载入目标日记；缺少该能力时明确提示，不假装已定位。
- UI 防抖 140ms，AbortSignal 取消上次查询，并用 request revision 防止不遵守取消的旧响应覆盖新结果。
- 401 / 403 / 5xx 和格式错误显示失败，不静默降级为本地结果。服务端返回纯文本摘要，前端不执行 HTML。
- 当前 UI 展示最相关 12 条，超出时提示增加关键词。接口保留 nextCursor，供后续加载更多。

## 项目执行汇总

`src/data/projectActivity.ts` 导出 `deriveProjectActivity(snapshot)`；顶部、主页、右侧执行栏均可从同一快照推导，避免各自定义口径。

```ts
counts: {
  running: number;
  queued: number;
  waitingReply: number;
  waitingPermission: number;
  failed: number;
}
```

`entries` 每条带 taskId / itemId / attemptId / sessionId 与可选 source；`groups` 按主任务分组，未关联会话独立归组。可选服务器聚合接口：`GET /v1/activity?projectId=…`，响应完全采用 `ProjectActivity` 类型。当前 UI 使用共享快照聚合，避免另一个轮询结果造成短暂不一致。

- “等我” = 待回复 + 待权限；失败独立显示。
- 已受理的 pending 派发归排队；尚未受理 / 状态未知不算运行。
- 人工任务、等待前置、未开始任务不计入运行中的 Agent。
- 主会话是子任务汇总时不额外计数；不同子会话的真实并行执行分别计数。
- 按 source.connectionId + source.tool + 真实子会话 / 会话标识 + 内嵌调用标识去重；同一会话被多个业务记录引用只算一次。同名 runtime ID 出现在不同连接时分别计数。
- 示例数据 4 运行 = 开发 A + 开发 A 的测试数据子代理 + 开发 B + WorkBuddy；2 等我 = 拼音确认 + Codex 术语确认。

## 校验

29 项领域 / HTTP / 请求竞态检查；9 项浏览器检查（键盘、错字匹配、取消、汇总、390px 宽度、页面异常）。脚本及结果保存在交付目录 `output/search-summary-tests/`。构建目录由 `tsc --rootDir src` 输出，测试使用 build/data/*.js。
