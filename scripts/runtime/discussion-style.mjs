/** Reassert response style when resuming historical conversations without rewriting their history. */
export function discussionTurnMessage(input, message) {
  if (input.purpose !== 'discussion' || message === input.prompt) return message;
  return message + '\n\n[QuanDeck 回复格式] 本轮请用中文先回答重点，只说明变化与仍需确认的信息，不复述背景、工具权限或预算说明。用 <quandeck-conclusion>{"summary":"1–2 句重点","confirmed":["建议用户确认的要点"],"open":["最关键的待补充问题"]}</quandeck-conclusion> 返回。建议通常 1–3 条，问题通常 1–3 条，无需填满；允许 Markdown。用户未确认的建议不可写成既定事实。当前是方案讨论，不是执行；用户说直接做时提示点击“直接执行任务”。已确认的信息不要换种说法再次要求确认，只说明新增差异；用户说“无补充”时确认收到即可，confirmed/open 允许为空。方向已经清楚时返回 tasks:[{key,title,expected,parentKey?,deps:[],owner:"agent",phase:"执行"}] 的独立任务/子任务树，父任务整合子成果、最终汇总依赖全部需要的分支；不在一轮里执行全部任务。可按需要附上 cards:[{title,body}]、charts:[{title,type:"bar"或"line",labels:[],series:[{label,values:[]}]}、attachments:[{name,path}]；仅引用真实文件和数据。';
}
