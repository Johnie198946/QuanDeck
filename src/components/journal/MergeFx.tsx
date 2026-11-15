import { useLayoutEffect, useRef } from "react";
import type { MergeFx } from "../../state/WorkdeckContext";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { AgentLogo } from "../ui/AgentLogo";

const EASE = "cubic-bezier(0.2, 0.7, 0.3, 1)";
const FLY = 300;
const REVEAL_DELAY = 240;
const REVEAL = 200;
const GLOW_DELAY = 420;
const GLOW = 200;

function tint(hex: string, alpha: number) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return `rgba(168, 68, 53, ${alpha})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

/** 源行原位收起：渲染“正在关联”时的静态快照（不可交互），高度平滑收为 0。 */
export function MergeCollapseSlot({ fx }: { fx: MergeFx }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = `${fx.height}px`;
    const anim = fx.reduced
      ? el.animate(
          [
            { opacity: 1, height: h },
            { opacity: 0, height: h, offset: 0.98 },
            { opacity: 0, height: "0px" },
          ],
          { duration: 160, fill: "forwards" },
        )
      : el.animate(
          [
            { opacity: 1, height: h },
            { opacity: 0.25, height: `${fx.height * 0.55}px`, offset: 0.45 },
            { opacity: 0, height: "0px" },
          ],
          { duration: FLY, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
        );
    return () => anim.cancel();
  }, [fx]);
  return (
    <div
      ref={ref}
      className="qd-merge-slot"
      aria-hidden="true"
      inert
      style={{ height: fx.height }}
      dangerouslySetInnerHTML={{ __html: fx.snapshot ?? "" }}
    />
  );
}

/**
 * 关联成功后的约 600ms 过渡：缩略副本（Logo + 短标题）沿短路径收拢到目标记录（300ms），
 * 目标记录展开（200ms），目标浅高亮淡出（200ms）。目标不在视野时先定位目标，不做飞行。
 */
export function MergeFxLayer() {
  const { mergeFx: fx, endMergeFx, agentOf } = useWorkdeck();
  const ghost = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!fx) return;
    const anims: Animation[] = [];
    let raf = 0;
    const done = setTimeout(endMergeFx, fx.reduced ? 240 : 760);
    const record = document.querySelector<HTMLElement>(`[data-record="${fx.sessionId}"]`);
    const task = document.querySelector<HTMLElement>(`[data-task="${fx.taskId}"]`);
    const scroller = document.querySelector<HTMLElement>(".qd-journal-scroll");
    const agent = agentOf(fx.agentId);
    const cleanup = () => {
      clearTimeout(done);
      cancelAnimationFrame(raf);
      anims.forEach((a) => a.cancel());
      if (record) {
        record.style.overflow = "";
      }
    };
    if (!record || !scroller) return cleanup;

    if (fx.reduced) {
      anims.push(record.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" }));
      if (!inView()) record.scrollIntoView({ block: "center" });
      return cleanup;
    }

    function inView() {
      const v = scroller!.getBoundingClientRect();
      const r = record!.getBoundingClientRect();
      return r.top >= v.top + 4 && r.top + 24 <= v.bottom - 4;
    }

    const targetVisible = inView();
    if (!targetVisible) record.scrollIntoView({ block: "center", behavior: "smooth" });

    // 1. 缩略副本收拢（仅源与目标都在视野内时）
    if (fx.from && targetVisible && ghost.current) {
      const g = ghost.current;
      const from = fx.from;
      const start = performance.now();
      g.style.opacity = "1";
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / FLY);
        const e = 1 - Math.pow(1 - t, 3);
        // 每帧读取目标位置：源行同时在收起，目标会上移
        const r = record.getBoundingClientRect();
        const tx = r.left;
        const ty = r.top + 11;
        const x = from.x + (tx - from.x) * e;
        const y = from.y + (ty - from.y) * e;
        g.style.transform = `translate(${x}px, ${y}px) translateY(-50%) scale(${1 - 0.1 * e})`;
        g.style.opacity = String(t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25);
        if (t < 1) raf = requestAnimationFrame(step);
        else g.style.opacity = "0";
      };
      raf = requestAnimationFrame(step);
    }

    // 2. 目标关联记录展开
    const cs = getComputedStyle(record);
    const h = record.offsetHeight;
    record.style.overflow = "hidden";
    anims.push(
      record.animate(
        [
          { height: "0px", paddingTop: "0px", paddingBottom: "0px", opacity: 0 },
          { height: `${h}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1 },
        ],
        { duration: REVEAL, delay: REVEAL_DELAY, easing: EASE, fill: "backwards" },
      ),
    );
    // 3. 目标浅高亮淡出
    if (task) {
      anims.push(
        task.animate(
          [
            { backgroundColor: tint(agent?.color ?? "", 0.1) },
            { backgroundColor: tint(agent?.color ?? "", 0.1), offset: 0.5 },
            { backgroundColor: tint(agent?.color ?? "", 0) },
          ],
          { duration: GLOW_DELAY + GLOW - FLY, delay: FLY },
        ),
      );
    }
    return cleanup;
  }, [fx, endMergeFx, agentOf]);

  if (!fx || fx.reduced || !fx.from) return null;
  const agent = agentOf(fx.agentId);
  const short = Array.from(fx.title).length > 14 ? `${Array.from(fx.title).slice(0, 14).join("")}…` : fx.title;
  return (
    <div
      ref={ghost}
      key={fx.key}
      className="qd-merge-ghost"
      aria-hidden="true"
      style={{ transform: `translate(${fx.from.x}px, ${fx.from.y}px) translateY(-50%)`, opacity: 0 }}
    >
      {agent && <AgentLogo agent={agent} size={16} />}
      <span>{short}</span>
    </div>
  );
}
