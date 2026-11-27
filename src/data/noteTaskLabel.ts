// Choose the requested action or the reported problem before shortening it.
// This also supplies an immediate label for rows beyond the Agent's sample.
export function noteTaskLabel(text: string) {
  const clean = text.replace(/(?:https?:\/\/\S+)/giu,'链接').replace(/^(?:如图\d*|如下图|举个例子)[，,:：\s]*/u,'').trim();
  if (Array.from(clean).length <= 22) return clean;
  const parts = clean.split(/(?:[，,。；;！？!?\n]|但是|然后|=>|=》)+/u).map(s=>s.trim()).filter(Boolean);
  function score(part: string) {
    let value = 0;
    if (/需要|应当|应该|支持|不能|点击|修复|优化|改成|改为|修改|还没|没有|并未|并没有|无法|返回|创建|确认|查询|调整|完成/u.test(part)) value += 3;
    if (/(?:需要|应当|应该|能够|支持).{1,25}(?:设置|调整|创建|输入|输出|获取|复制|执行|访问|查询|打开|返回|追溯|导出)/u.test(part)) value += 2;
    if (/我(?:刚刚|之前|发现|感觉)|举例|如下图|例如|比如|如图|做了个测试|我把这|之所以|这两个作为|也就是|任务需求$|具体你看/u.test(part)) value -= 4;
    if (/^(?:和|然后|因为|再加上)/u.test(part) || part.length < 4) value -= 2;
    return value;
  }
  const best = parts.reduce((best,p)=>score(p)>score(best)?p:best,parts[0] ?? clean);
  const label = best.replace(/^(?:我(?:觉得|发现|认为)|我(?:还)?(?:想要|需要|希望)|请(?:帮我|你)|你(?:要|需要)|(?:这里|现在)(?:需要|要))\s*/u,'').trim() || best;
  const glyphs=Array.from(label);
  return glyphs.length>24 ? glyphs.slice(0,23).join('')+'…' : label;
}

export interface TaskLabelAnswer {answer:string; labels: {item:number; title:string}[]}
export function readTaskLabels(answer:string): TaskLabelAnswer | undefined {
  const value=answer.trim().replace(/^`{3}(?:json)?\s*|\s*`{3}$/gu,'');
  if (!value.startsWith('{')) return;
  try {
    const result=JSON.parse(value);
    if(typeof result.answer!=='string' || !result.answer.trim() || !Array.isArray(result.labels)) return;
    const labels:TaskLabelAnswer['labels']=[];
    for(const row of result.labels){
      if(Number.isInteger(row?.item) && row.item>0 && typeof row.title==='string' &&
        Array.from(row.title.trim()).length>=2 && Array.from(row.title.trim()).length<=24 && !/[\r\n<>]/u.test(row.title))
        labels.push({item:row.item,title:row.title.trim()});
    }
    return {answer:result.answer,labels};
  } catch { return; }
}
