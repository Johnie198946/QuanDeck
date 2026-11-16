import { formatDuration, formatTokens, toMinutes } from "../../../data/format";
import { useWorkdeck } from "../../../state/WorkdeckContext";
import { AgentSwatch } from "../../ui/AgentBadge";

const DAY_START = 0;
const DAY_END = 24 * 60;
import { purposeMetrics } from '../../../data/purposeMetrics';
import { nextDate } from '../../../data/timeline';

export function StatsPanel() {
  const { snap } = useWorkdeck();
  const { stats } = snap;
  const purpose = purposeMetrics(snap);
  const largest = Math.max(1, ...Object.values(purpose).map(v => v.minutes));
  const nowMin = toMinutes(snap.now);
  const pct = (m: number) =>
    ((Math.min(Math.max(m, DAY_START), DAY_END) - DAY_START) / (DAY_END - DAY_START)) * 100;
  const days = Array.from({ length: 14 }, (_, i) => i);
  const totals = days.map((d) => snap.agents.reduce((sum, a) => sum + (a.daily14[d] ?? 0), 0));
  const max = Math.max(60, ...totals);

  return (
    <div className="qd-stats">
      <p className="qd-panel-note">
        当前项目 · Agent 执行记录
      </p>

      <section aria-label="规划、执行与人工投入">
        <h3 className="qd-panel-section">时间用在了哪里</h3>
        {([['discussion', '分析与讨论', '#857697'], ['execution', 'Agent 执行', '#598b7b'], ['manual', '人工完成', '#b68859']] as const).map(([kind, label, color]) => <div key={kind} className="qd-purpose-row"><div><span>{label}</span><strong>{formatDuration(purpose[kind].minutes)}</strong></div><div className="qd-purpose-track"><span style={{ width: `${purpose[kind].minutes / largest * 100}%`, background: color }} /></div>{kind !== 'manual' && <small>{formatTokens(purpose[kind].tokens)}</small>}</div>)}
      </section>
      <section>
        <h3 className="qd-panel-section">今日</h3>
        <div className="qd-metrics">
          <div>
            <strong>{formatDuration(stats.collabMinutes)}</strong>
            <span>协作分钟 · 会话累计</span>
          </div>
          <div>
            <strong>{formatTokens(stats.tokens).replace(" token", "")}</strong>
            <span>token · 同窗可比</span>
          </div>
          <div>
            <strong>{stats.sessions ?? "未提供"}</strong>
            <span>有活动的会话</span>
          </div>
        </div>
        <p className="qd-wall">
          墙钟覆盖 {formatDuration(stats.wallMinutes)}（并集，另列，不与累计相加）
        </p>

        <div className="qd-activity" role="img" aria-label="今日活动分布，00:00 至 24:00">
          {snap.agents.map((a) => (
            <div key={a.id} className="qd-activity-row">
              <span className="qd-activity-label">{a.short}</span>
              <div className={`qd-activity-track ${a.today.minutes == null ? "is-uncovered" : ""}`}>
                {a.today.minutes == null && <span className="qd-activity-none">未覆盖</span>}
                {snap.activity
                  .filter((i) => i.agentId === a.id)
                  .map((i, idx) => {
                    const s = toMinutes(i.start);
                    const e = i.end === "now" ? nowMin : toMinutes(i.end);
                    return (
                      <span
                        key={idx}
                        className="qd-activity-seg"
                        title={`${a.name} ${i.start}—${i.end === "now" ? `${snap.now}（运行中，截至最后确认）` : i.end}`}
                        style={{
                          left: `${pct(s)}%`,
                          width: `${Math.max(0.8, pct(e) - pct(s))}%`,
                          background: a.color,
                        }}
                      />
                    );
                  })}
                <span className="qd-activity-now" style={{ left: `${pct(nowMin)}%` }} />
              </div>
            </div>
          ))}
          <div className="qd-activity-axis" aria-hidden="true">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </div>
        </div>
      </section>

      <section>
        <h3 className="qd-panel-section">近 14 天 · 按 Agent 堆叠协作分钟</h3>
        <div
          className="qd-stack"
          role="img"
          aria-label={`近 14 天每日协作分钟合计：${totals.join("、")}`}
        >
          {days.map((d) => (
            <div
              key={d}
              className="qd-stack-col"
              title={`${d === 13 ? "今日" : `${13 - d} 天前`}：共 ${totals[d]} 分钟`}
            >
              <div className="qd-stack-bar" style={{ height: `${(totals[d] / max) * 100}%` }}>
                {snap.agents.map((a) =>
                  a.daily14[d] ? (
                    <span
                      key={a.id}
                      style={{ flexGrow: a.daily14[d], background: a.color }}
                      title={`${a.name}：${a.daily14[d]} 分钟`}
                    />
                  ) : null,
                )}
              </div>
              <span className="qd-stack-day">
                {d === 13 ? "今" : d % 3 === 1 ? nextDate(snap.date, d - 13).slice(8) : ""}
              </span>
            </div>
          ))}
        </div>
        <ul className="qd-legend">
          {snap.agents.map((a) => (
            <li key={a.id}>
              <AgentSwatch agent={a} />
              {a.name}
              <span>
                {a.daily14.every((v) => v == null)
                  ? "— 未覆盖"
                  : `${a.daily14.reduce<number>((x, y) => x + (y ?? 0), 0)} 分钟`}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
