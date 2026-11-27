import type { CanvasIdea } from '../../data/inspirationCanvas';
import { LinkCard } from './NoteInlineCards';
import './method-import.css';

const actions:Record<string,string>={
  预订办理:'前往预订网站', 路线规划:'查看路线工具', 资料检索:'查看资料网站', 比较筛选:'打开比较工具',
  检查确认:'打开核对页面', 整理输出:'打开整理工具', 参考灵感:'查看参考网页',
};
export function MethodStepDetails({idea}:{idea?:CanvasIdea}) {
  const step=idea?.method;
  if(!step)return null;
  return <section className="qd-method-detail" aria-label="步骤依据">
    <b>{step.component}</b>
    <dl>{[['输入',step.input],['输出',step.output],['检查标准',step.standard]].filter(([,value])=>value).map(([key,value])=>
      <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
    {step.url && <LinkCard url={step.url} label={actions[step.component]||'打开步骤中的网址'}/>}
    <details><summary>查看依据 · {step.sourceTitle}</summary><blockquote>{step.quote}</blockquote></details>
  </section>;
}
