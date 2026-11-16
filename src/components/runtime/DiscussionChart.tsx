import { useId } from 'react';
import type { DiscussionChart as Chart } from '../../data/discussionPresentation';

export function DiscussionChart({ chart }: { chart: Chart }) {
  const id = useId();
  const width = 640, height = 240, left = 48, right = 16, top = 20, bottom = 38;
  const values = chart.series.flatMap(series => series.values);
  const min = Math.min(0, ...values), max = Math.max(1, ...values);
  const y = (value: number) => top + (max - value) / (max - min) * (height - top - bottom);
  const step = (width - left - right) / chart.labels.length;
  const palette = ['#ad4433', '#347863', '#526e99', '#a36d20', '#80678e', '#326d7a', '#6e7434', '#825b53'];
  return <figure className="qd-discussion-chart">
    <figcaption id={id}>{chart.title}</figcaption>
    <div className="qd-chart-plot" tabIndex={0} role="region" aria-label={`${chart.title}图形，可横向滚动`}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={id}>
      {[min, (max + min) / 2, max].map((value, index) => <g key={index}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="#e4e7e6" /><text x={left - 8} y={y(value) + 4} textAnchor="end" fill="#66716f" fontSize="11">{Number(value.toPrecision(3))}</text></g>)}
      {chart.series.map((series, seriesIndex) => chart.type === 'line' ? <g key={seriesIndex}>
        <polyline fill="none" stroke={palette[seriesIndex]} strokeWidth="2.5" points={series.values.map((value, index) => `${left + (index + 0.5) * step},${y(value)}`).join(' ')} />
        {series.values.map((value, index) => <circle key={index} cx={left + (index + 0.5) * step} cy={y(value)} r="3" fill={palette[seriesIndex]}><title>{chart.labels[index]} · {series.label}：{value}</title></circle>)}
      </g> : <g key={seriesIndex}>{series.values.map((value, index) => <rect key={index} x={left + index * step + step * 0.12 + seriesIndex * step * 0.76 / chart.series.length} y={Math.min(y(0), y(value))} width={step * 0.7 / chart.series.length} height={Math.abs(y(0) - y(value))} fill={palette[seriesIndex]} rx="2"><title>{chart.labels[index]} · {series.label}：{value}</title></rect>)}</g>)}
      {chart.labels.map((label, index) => index % Math.max(1, Math.ceil(chart.labels.length / 8)) === 0 && <text key={index} x={left + (index + 0.5) * step} y={height - 12} textAnchor="middle" fill="#66716f" fontSize="11">{label.length > 9 ? label.slice(0, 8) + '…' : label}</text>)}
    </svg></div>
    <div className="qd-chart-legend">{chart.series.map((series, index) => <span key={index}><i style={{ backgroundColor: palette[index] }} />{series.label}</span>)}</div>
    <details><summary>查看数据表</summary><div className="qd-table-scroll"><table><thead><tr><th scope="col">项目</th>{chart.series.map((series, index) => <th scope="col" key={index}>{series.label}</th>)}</tr></thead><tbody>{chart.labels.map((label, index) => <tr key={index}><th scope="row">{label}</th>{chart.series.map((series, s) => <td key={s}>{series.values[index]}</td>)}</tr>)}</tbody></table></div></details>
  </figure>;
}
