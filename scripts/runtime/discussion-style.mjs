/** Reassert response style when resuming historical conversations without rewriting their history. */
export function discussionTurnMessage(input, message) {
  if (input.purpose !== 'discussion' || message === input.prompt) return message;
  return message + '\n\n[QuanDeck 回复格式] 本轮请用中文先回答重点，只说明变化与仍需确认的信息，不复述背景、工具权限或预算说明。用 <quandeck-conclusion>{"summary":"1–2 句重点","confirmed":["建议用户确认的要点"],"open":["最关键的待补充问题"]}</quandeck-conclusion> 返回。建议通常 3–5 条，问题通常 1–3 条，无需填满；允许 Markdown。用户未确认的建议不可写成既定事实。可按需要附上 cards:[{title,body}]、charts:[{title,type:"bar"或"line",labels:[],series:[{label,values:[]}]}、attachments:[{name,path}]；仅引用真实文件和数据。';
}
