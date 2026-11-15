import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/** 轻量弹出层：点击外部或 Esc 关闭，焦点回到触发点。 */
export function Popover({
  open,
  onClose,
  children,
  align = "right",
  className = "",
  label,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose 每次渲染都是新函数；放进 ref，避免数据刷新时重跑 effect、抢走焦点或误判触发点
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const onClose = () => closeRef.current();
    const onDown = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        !trigger?.contains(e.target as Node)
      )
        onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        trigger?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLElement>("button,input,select")?.focus(),
    );
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={`qd-popover align-${align} ${className}`}
    >
      {children}
    </div>
  );
}
