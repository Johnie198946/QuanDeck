import { useId } from "react";

/**
 * QuanDeck 标志的矢量重建（PRD §7.5.3）：开口几何 Q，方圆轮廓、左侧横向切口、右下短尾。
 * 图形 #A84435，字标 #202124；无渐变、光晕或阴影。
 */
export function QuanDeckMark({ size = 24, title }: { size?: number; title?: string }) {
  const maskId = useId();
  return (
    <svg
      width={(size * 112) / 98}
      height={size}
      viewBox="0 0 112 98"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className="qd-mark"
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="112" height="98">
        <rect width="112" height="98" fill="#fff" />
        <rect x="-1" y="40.4" width="27.6" height="8.2" fill="#000" />
      </mask>
      <g fill="var(--qd-brand)" mask={`url(#${maskId})`}>
        <path
          fillRule="evenodd"
          d="M34 0H66C84.8 0 100 15.2 100 34V55C100 73.8 84.8 89 66 89H34C15.2 89 0 73.8 0 55V34C0 15.2 15.2 0 34 0ZM40.6 20C32.3 20 25.6 26.7 25.6 35V54.5C25.6 62.8 32.3 69.5 40.6 69.5H61.4C69.7 69.5 76.4 62.8 76.4 54.5V35C76.4 26.7 69.7 20 61.4 20Z"
        />
      </g>
      <path
        d="M90.2 72.4L109.6 92.6C111 94.1 110 96.4 108 96.4H86.2C85.1 96.4 84.1 96 83.4 95.2L73 84.2Z"
        fill="var(--qd-brand)"
      />
    </svg>
  );
}

export function QuanDeckLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="qd-logo" aria-label="QuanDeck">
      <QuanDeckMark size={24} />
      {!compact && <span className="qd-wordmark">QuanDeck</span>}
    </span>
  );
}
