// A note handoff uses the same goal, acceptance list and delivery field as a project task.
// Keep all original text with the source input. Derive requirements only from the selected passage.
export const noteReplyDelivery = '在任务中交回答复。';

const fieldNames: Record<string, 'goal'|'information'|'criteria'|'deliverable'> = {
  需求:'goal', 目标:'goal', 任务目标:'goal', 背景:'information', 验收:'criteria', 验收标准:'criteria', 交付:'deliverable', 交付物:'deliverable',
};

export function noteRequirement(text: string) {
  const fields = {goal:[] as string[], information:[] as string[], criteria:[] as string[], deliverable:[] as string[]};
  let structured = false;
  let field: keyof typeof fields = 'goal';
  for (const raw of text.trim().split(/\r?\n/u)) {
    const line = raw.trim();
    const match = /^(?:#{1,4}\s*)?(任务目标|目标|需求|背景|验收标准|验收|交付物|交付)\s*[:：]\s*(.*)$/u.exec(line);
    if (match) { field = fieldNames[match[1]]; structured = true; }
    const value = match ? match[2].trim() : line;
    if (value) fields[field].push(value);
  }
  const goal = structured && fields.goal.length ? fields.goal.join('\n') : text.trim();
  const headline = (fields.goal[0] ?? goal).replace(/^(?:[-*•]\s+|\d+[.、）)]\s*)/u, '').trim();
  const title = [...headline].length > 64 ? [...headline].slice(0,63).join('')+'…' : headline;
  const capability = /^([^\n，。；！？:：]{1,24}?)(?:需要|应该|应当|必须|希望)(?:能(?:够)?|支持|允许|可以)([^。！？\n]+)[。！]?$/u.exec(headline);
  const editRequest = /(?:增加|新增|添加|修复|实现|改造|重构|删除|移除|拖拽|复制到|粘贴到|下载到|导出到|支持.{1,16}(?:功能|模式|排序)|(?:修改|编辑).{0,16}(?:源码|代码|文件|界面|按钮)|\b(?:implement|refactor|install|modify|add|fix|remove)\b)/iu;
  const replyRequest = /翻译|解释|说明|总结|归纳|对比|比较|列出|列举|回答|建议|选一条路线|算出|告诉我|是什么意思|怎么回复|如何回复|\b(?:translate|summarize|compare|explain)\b/iu;
  const intent = goal.replace(/[「“][^」”\n]*[」”]|`[^`\n]+`/gu,'');
  const explicitlyText = /^(?:请(?:帮我)?|帮我)?(?:将|把)?[^。！？\n]{0,180}翻译(?:成|为|一下)(?:英语?|中文|日语?|法语?|西班牙语|德语)?[。！？]?$/u.test(intent)
    || /^(?:请)?(?:只|仅)(?:需|要|用)?(?:用文字)?(?:回复|回答|解释|说明)/u.test(intent);
  const actionRequested = !explicitlyText && (editRequest.test(intent) || !!capability);
  const textReply = explicitlyText || (!actionRequested && replyRequest.test(intent));
  const criteria = fields.criteria.map(value=>value.replace(/^[-*•]\s+/u,''));
  if (!criteria.length) {
    if (capability && !/不$/u.test(capability[1])) {
      criteria.push(capability[1]+'可以'+capability[2]+'。');
      if (/(?:复制|拷贝).*(?:出去|到其他|到别的|到外部)/u.test(capability[2])) {
        criteria.push('粘贴到另一个应用后，内容与原文一致。');
      }
    } else {
      // Preserve negations, quantities and ordering when the passage supplies no separate checklist.
      const requested = fields.goal.filter(line => line.length <= 2000);
      if (requested.length && requested.length === fields.goal.length && requested.length <= 50) criteria.push(...requested);
      else criteria.push('按任务目标逐项核对，保留原文中的限制。');
    }
  }
  const deliverable = fields.deliverable.join('\n') || (textReply ? noteReplyDelivery :
    actionRequested ? '可使用的改动，以及实际操作的验证结果。' : '按原文要求交回成果和核对结果。');
  return {title,goal,criteria,information:fields.information.join('\n') || undefined,deliverable};
}
