import { useId, useState } from "react";
import { isDiscussionChart, type DiscussionChart } from "../../data/discussionPresentation";
import "./note-answer-chart.css";

const styles = { bar: "柱状图", line: "折线图", area: "面积图", donut: "环形图", dot: "点图" };
type ChartStyle = keyof typeof styles;
export type NoteChartData = Omit<DiscussionChart, "type"> & { type: ChartStyle };
const palette = [
  "#3166ad",
  "#b15b3a",
  "#40816e",
  "#8564a4",
  "#ad781d",
  "#496665",
  "#a44c73",
  "#5f733b",
];
const color = (index: number) => palette[index % palette.length];

export function readNoteChart(source: string): NoteChartData | undefined {
  if (source.length > 96000) return;
  try {
    const chart = JSON.parse(source);
    if (
      chart &&
      Object.prototype.hasOwnProperty.call(styles, chart.type) &&
      isDiscussionChart({ ...chart, type: "bar" })
    )
      return chart;
  } catch {
    /* Keep an invalid or partially streamed block available as text. */
  }
}

function CartesianPlot({
  chart,
  kind,
}: {
  chart: NoteChartData;
  kind: Exclude<ChartStyle, "donut">;
}) {
  const left = 56,
    right = 612,
    top = 18,
    bottom = 176;
  const values = chart.series.flatMap((s) => s.values);
  const low = Math.min(0, ...values),
    high = Math.max(0, ...values) || (low === 0 ? 1 : 0);
  const step = (right - left) / chart.labels.length;
  const x = (i: number) => left + (i + 0.5) * step;
  const scale = Math.max(Math.abs(low), Math.abs(high)) || 1;
  const y = (n: number) =>
    top + ((high / scale - n / scale) / (high / scale - low / scale)) * (bottom - top);
  return (
    <>
      {[low, low / 2 + high / 2, high].map((n, i) => (
        <g key={i}>
          <line x1={left} x2={right} y1={y(n)} y2={y(n)} stroke="currentColor" opacity=".13" />
          <text x={left - 6} y={y(n) + 4} textAnchor="end">
            {Number(n.toPrecision(3))}
          </text>
        </g>
      ))}
      <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="currentColor" opacity=".3" />
      {chart.series.map((s, k) => {
        const points = s.values.map((v, i) => x(i) + "," + y(v)).join(" ");
        const width = (step * 0.76) / chart.series.length;
        return (
          <g key={k} fill={color(k)}>
            {kind === "area" && (
              <polygon
                className="qn-area-fill"
                opacity=".22"
                points={
                  x(0) + "," + y(0) + " " + points + " " + x(s.values.length - 1) + "," + y(0)
                }
              />
            )}
            {(kind === "area" || kind === "line") && (
              <polyline
                className="qn-line-draw"
                points={points}
                pathLength={1}
                fill="none"
                stroke={color(k)}
                strokeWidth="2.5"
              />
            )}
            {s.values.map((v, i) => {
              const title = (
                <title>
                  {chart.labels[i]} · {s.label} · {v}
                </title>
              );
              const offset = x(i) - step * 0.38 + k * width;
              return kind === "bar" ? (
                <rect
                  className="qn-bar-grow"
                  style={{ transformOrigin: "0px " + y(0) + "px" }}
                  key={i}
                  x={offset}
                  width={width * 0.9}
                  y={Math.min(y(0), y(v))}
                  height={Math.abs(y(v) - y(0))}
                  rx={1.5}
                >
                  {title}
                </rect>
              ) : (
                <circle
                  className="qn-dot-in"
                  key={i}
                  cx={kind === "dot" ? offset + width / 2 : x(i)}
                  cy={y(v)}
                  r={kind === "dot" ? 4.5 : 3}
                >
                  {title}
                </circle>
              );
            })}
          </g>
        );
      })}
      {chart.labels.map(
        (label, i) =>
          i % Math.max(1, Math.ceil(chart.labels.length / 7)) === 0 && (
            <text key={i} x={x(i)} y={bottom + 21} textAnchor="middle">
              <title>{label}</title>
              {label.length > 8 ? label.slice(0, 7) + "…" : label}
            </text>
          ),
      )}
    </>
  );
}

function RingPlot({ chart }: { chart: NoteChartData }) {
  const values = chart.series[0].values;
  const largest = Math.max(...values);
  const total = values.reduce((n, v) => n + v / largest, 0);
  let offset = 0;
  return (
    <g transform="translate(320 104) rotate(-90)">
      {values.map((v, i) => {
        if (!v) return null;
        const length = (v / largest / total) * 100,
          start = offset;
        offset += length;
        return (
          <circle
            className="qn-ring-in"
            key={i}
            r="72"
            fill="none"
            stroke={color(i)}
            strokeWidth="28"
            pathLength={100}
            strokeDasharray={length + " " + (100 - length)}
            strokeDashoffset={-start}
          >
            <title>
              {chart.labels[i]} · {v} ({length.toFixed(1)}%)
            </title>
          </circle>
        );
      })}
    </g>
  );
}

export function NoteAnswerChart({ chart }: { chart: NoteChartData }) {
  const id = useId();
  const [chosen, setChosen] = useState<ChartStyle>();
  const ringOK =
    chart.series.length === 1 &&
    chart.series[0].values.every((n) => n >= 0) &&
    chart.series[0].values.some((n) => n > 0);
  const desired = chosen ?? chart.type;
  const kind = desired === "donut" && !ringOK ? "bar" : desired;
  const legend =
    kind === "donut"
      ? chart.labels.map((label, i) => label + " · " + chart.series[0].values[i])
      : chart.series.map((s) => s.label);
  return (
    <figure className="qn-answer-chart" data-chart-style={kind}>
      <figcaption>
        <strong id={id}>{chart.title}</strong>
        <select
          value={kind}
          aria-label="图表样式"
          onChange={(e) => setChosen(e.target.value as ChartStyle)}
        >
          {Object.entries(styles).map(([key, label]) => (
            <option key={key} value={key} disabled={key === "donut" && !ringOK}>
              {label}
            </option>
          ))}
        </select>
      </figcaption>
      <svg key={kind} viewBox="0 0 640 208" role="img" aria-labelledby={id}>
        {kind === "donut" ? (
          <RingPlot chart={chart} />
        ) : (
          <CartesianPlot chart={chart} kind={kind} />
        )}
      </svg>
      <div className="qn-plot-legend">
        {legend.map((item, i) => (
          <span key={i}>
            <i style={{ backgroundColor: color(i) }} />
            {item}
          </span>
        ))}
      </div>
      <details>
        <summary>查看数据表</summary>
        <div className="qd-answer-table">
          <table>
            <thead>
              <tr>
                <th scope="col">项目</th>
                {chart.series.map((s, i) => (
                  <th scope="col" key={i}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chart.labels.map((l, i) => (
                <tr key={i}>
                  <th scope="row">{l}</th>
                  {chart.series.map((s, k) => (
                    <td key={k}>{s.values[i]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
