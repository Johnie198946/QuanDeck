import { isValidElement, type ReactNode } from 'react';
import { isDiscussionChart } from '../../data/discussionPresentation';
import { readFlowDiagram } from '../../data/flowDiagram';
import { FlowDiagram } from '../discussion/FlowDiagram';
import { DiscussionChart } from './DiscussionChart';

/** Only two explicit data formats become figures; ordinary code examples stay code. */
export function FigureCode({ children }: { children?: ReactNode }) {
  if (!isValidElement<{className?: string; children?: unknown}>(children)) return <pre>{children}</pre>;
  const { className, children: source } = children.props;
  if (typeof source !== 'string' || !['language-quandeck-chart', 'language-quandeck-flow'].includes(className ?? '')) return <pre>{children}</pre>;
  try {
    if (source.length <= 96000) {
      const value: unknown = JSON.parse(source);
      if (className === 'language-quandeck-chart' && isDiscussionChart(value)) return <DiscussionChart chart={value} />;
      if (className === 'language-quandeck-flow') return <FlowDiagram graph={readFlowDiagram(value)} title="步骤示意" />;
    }
  } catch { /* Keep malformed source available for correction. */ }
  return <details className="qd-figure-fallback"><summary>图表暂时无法显示 · 查看原数据</summary><pre>{children}</pre></details>;
}
