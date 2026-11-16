import type { ReactNode } from "react";

export type IconName =
  | "plane"
  | "chevron-down"
  | "chevron-right"
  | "chevron-left"
  | "arrow-right"
  | "external"
  | "expand"
  | "collapse"
  | "grip"
  | "plus"
  | "search"
  | "calendar"
  | "check-square"
  | "folder"
  | "user"
  | "box"
  | "chart"
  | "message"
  | "clock"
  | "close"
  | "check"
  | "star"
  | "pin"
  | "refresh"
  | "merge"
  | "enter"
  | "pencil"
  | "alert"
  | "flask"
  | "undo"
  | "dot"
  | "sliders"
  | "play"
  | "pause"
  | "reply"
  | "lock"
  | "send"
  | "inbox"
  | "x-circle"
  | "check-circle"
  | "help-circle"
  | "link";

const PATHS: Record<IconName, ReactNode> = {
  pause: <><path d="M8 5v14"/><path d="M16 5v14"/></>,
  play: <path d="M8 5.5v13l10-6.5Z" />,
  reply: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5A5.5 5.5 0 0 1 20 14.5V20" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  send: (
    <>
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13h4l1.5 3h5L16 13h4" />
      <path d="M5.5 5h13L20 13v6H4v-6Z" />
    </>
  ),
  "x-circle": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  "check-circle": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.4 2.4 4.6-4.9" />
    </>
  ),
  "help-circle": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.7 9.5a2.4 2.4 0 0 1 4.6.9c0 1.6-2.3 2-2.3 3.3" />
      <path d="M12 16.6h.01" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  plane: (
    <>
      <path d="M21 3 10.5 13.5" />
      <path d="M21 3 14.5 21l-4-7.5L3 9.5Z" />
    </>
  ),
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  "chevron-left": <path d="m15 6-6 6 6 6" />,
  "arrow-right": (
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  expand: <path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" />,
  collapse: <path d="M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5" />,
  external: (
    <>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </>
  ),
  grip: (
    <>
      {[6, 12, 18].map((y) => (
        <g key={y}>
          <circle cx="9" cy={y} r="1.1" fill="currentColor" stroke="none" />
          <circle cx="15" cy={y} r="1.1" fill="currentColor" stroke="none" />
        </g>
      ))}
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  "check-square": (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  folder: (
    <path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20c.9-3.9 3.6-6 7.5-6s6.6 2.1 7.5 6" />
    </>
  ),
  box: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </>
  ),
  chart: (
    <>
      <path d="M5 19v-5M10 19V9M15 19v-7M20 19V5" />
    </>
  ),
  message: (
    <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3v-3H5A1.5 1.5 0 0 1 3.5 16V7A1.5 1.5 0 0 1 5 5.5Z" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  star: <path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8Z" />,
  pin: (
    <>
      <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3Z" />
      <path d="M12 14v6" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </>
  ),
  merge: (
    <>
      <path d="M6 4v5a5 5 0 0 0 5 5h7" />
      <path d="m15 11 3 3-3 3" />
      <path d="M6 20v-4" />
    </>
  ),
  enter: (
    <>
      <path d="M19 6v5a3 3 0 0 1-3 3H6" />
      <path d="m9.5 10.5-3.5 3.5 3.5 3.5" />
    </>
  ),
  pencil: (
    <>
      <path d="M15.5 5.5 18.5 8.5 9 18H6v-3Z" />
      <path d="m13.5 7.5 3 3" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.5" />
      <circle cx="12" cy="16.3" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  flask: (
    <>
      <path d="M9.5 3.5h5M10.5 3.5v6L5 19a1.5 1.5 0 0 0 1.3 2.2h11.4A1.5 1.5 0 0 0 19 19l-5.5-9.5v-6" />
      <path d="M7.5 15h9" />
    </>
  ),
  undo: (
    <>
      <path d="M9 7 5 11l4 4" />
      <path d="M5 11h9.5a4.5 4.5 0 0 1 0 9H12" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />,
  sliders: (
    <>
      <path d="M5 7h9M18 7h1M5 17h3M12 17h7" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
