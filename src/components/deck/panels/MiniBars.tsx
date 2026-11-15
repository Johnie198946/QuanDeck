/** 14 天协作分钟微图（单位：分钟）；null = 当日未覆盖，画虚线占位而非 0。 */
export function MiniBars({
  values,
  color,
  label,
}: {
  values: (number | null)[];
  color: string;
  label: string;
}) {
  const max = Math.max(60, ...values.map((v) => v ?? 0));
  return (
    <svg
      className="qd-minibars"
      viewBox={`0 0 ${values.length * 6} 24`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label} 近 14 天协作分钟：${values.map((v) => (v == null ? "未覆盖" : v)).join("、")}`}
    >
      {values.map((v, i) => {
        const day = i === values.length - 1 ? "今日" : `${values.length - 1 - i} 天前`;
        if (v == null)
          return (
            <rect key={i} x={i * 6 + 1} y={22} width={4} height={1} fill="none" stroke="#C4C9CE" strokeWidth={0.6} strokeDasharray="1 1">
              <title>{`${day}：未覆盖`}</title>
            </rect>
          );
        const h = v ? Math.max(2, (v / max) * 22) : 1;
        return (
          <rect
            key={i}
            x={i * 6 + 1}
            y={24 - h}
            width={4}
            height={h}
            rx={1}
            fill={v ? color : "#DFE3E7"}
          >
            <title>{`${day}：${v} 分钟`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
