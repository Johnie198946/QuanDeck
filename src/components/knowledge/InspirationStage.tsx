import { useId, useRef, useState, type PointerEvent } from "react";
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  type CanvasPoint,
  type InspirationBoard,
  type InspirationNode,
} from "../../data/inspirationCanvas";
import type { KnowledgeNote } from "../../data/knowledgeNotes";
import { NoteThumbnail } from "./NoteThumbnail";
import { Icon } from "../ui/Icon";

export type CanvasView = { title: string; note?: KnowledgeNote; typeLabel: string };
export type CanvasSelection = { kind: "note" | "link"; id: string } | null;
type Gesture =
  | { type: "move"; id: string; start: CanvasPoint; original: CanvasPoint }
  | { type: "wire"; id: string; start: CanvasPoint }
  | { type: "pan"; start: CanvasPoint; original: CanvasPoint };

function wirePath(a: CanvasPoint, b: CanvasPoint) {
  if (b.x >= a.x + 65) {
    const mid = (a.x + b.x) / 2;
    return {
      d: `M ${a.x} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${b.x} ${b.y}`,
      label: { x: mid, y: (a.y + b.y) / 2 },
    };
  }
  const below = Math.max(a.y, b.y) + NODE_HEIGHT / 2 + 45;
  return {
    d: `M ${a.x} ${a.y} C ${a.x + 48} ${a.y}, ${a.x + 48} ${below}, ${a.x} ${below} H ${b.x} C ${b.x - 48} ${below}, ${b.x - 48} ${b.y}, ${b.x} ${b.y}`,
    label: { x: (a.x + b.x) / 2, y: below },
  };
}
const output = (node: CanvasPoint) => ({ x: node.x + NODE_WIDTH + 3, y: node.y + NODE_HEIGHT / 2 });
const input = (node: CanvasPoint) => ({ x: node.x - 5, y: node.y + NODE_HEIGHT / 2 });

export function InspirationStage({
  board,
  notes,
  selection,
  select,
  wireFrom,
  setWireFrom,
  connect,
  move,
  insert,
}: {
  board: InspirationBoard;
  notes: Map<string, CanvasView>;
  selection: CanvasSelection;
  select: (value: CanvasSelection) => void;
  wireFrom: string | null;
  setWireFrom: (id: string | null) => void;
  connect: (from: string, to: string) => void;
  move: (id: string, point: CanvasPoint) => Promise<void>;
  insert: () => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const dragging = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<InspirationNode | null>(null);
  const [cursor, setCursor] = useState<CanvasPoint | null>(null);
  const [scale, setScale] = useState(1);
  const marker = useId().replace(/:/g, "");
  const nodes = new Map(
    board.nodes.map((node) => [node.noteId, preview?.noteId === node.noteId ? preview : node]),
  );
  const width = Math.max(580, ...Array.from(nodes.values(), (node) => node.x + NODE_WIDTH + 64));
  const height = Math.max(416, ...Array.from(nodes.values(), (node) => node.y + NODE_HEIGHT + 115));

  function coords(event: PointerEvent): CanvasPoint {
    const rect = surface.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || !frame.current) return;
    const target = event.target as Element;
    const source = target.closest<HTMLElement>("[data-output]");
    const node = target.closest<HTMLElement>("[data-drag-note]");
    const start = coords(event);
    if (source?.dataset.output) {
      const id = source.dataset.output;
      setWireFrom(id);
      setCursor(null);
      dragging.current = { type: "wire", id, start };
    } else if (node && !wireFrom) {
      const id = node.dataset.dragNote!;
      const original = nodes.get(id)!;
      select({ kind: "note", id });
      dragging.current = { type: "move", id, start, original };
    } else if (!target.closest("button, [data-edge]") && board.nodes.length) {
      dragging.current = {
        type: "pan",
        start: { x: event.clientX, y: event.clientY },
        original: { x: frame.current.scrollLeft, y: frame.current.scrollTop },
      };
    } else return;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const gesture = dragging.current;
    if (!gesture) return;
    const point = coords(event);
    if (gesture.type === "wire") setCursor(point);
    if (gesture.type === "move")
      setPreview({
        ...nodes.get(gesture.id)!,
        x: Math.max(12, gesture.original.x + point.x - gesture.start.x),
        y: Math.max(12, gesture.original.y + point.y - gesture.start.y),
      });
    if (gesture.type === "pan")
      frame.current?.scrollTo(
        gesture.original.x + gesture.start.x - event.clientX,
        gesture.original.y + gesture.start.y - event.clientY,
      );
  }
  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    const gesture = dragging.current;
    dragging.current = null;
    if (gesture?.type === "wire") {
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-input], [data-drag-note]");
      const to = target?.dataset.input || target?.dataset.dragNote;
      if (target && surface.current?.contains(target) && to && to !== gesture.id)
        connect(gesture.id, to);
      else if (Math.hypot(coords(event).x - gesture.start.x, coords(event).y - gesture.start.y) > 6)
        setWireFrom(null);
    }
    setCursor(null);
    if (gesture?.type === "move") {
      const end = coords(event);
      const dx = end.x - gesture.start.x;
      const dy = end.y - gesture.start.y;
      if (Math.hypot(dx, dy) > 2) {
        const point = {
          x: Math.max(12, gesture.original.x + dx),
          y: Math.max(12, gesture.original.y + dy),
        };
        void move(gesture.id, point).finally(() => setPreview(null));
      } else setPreview(null);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function cancel() {
    dragging.current = null;
    setPreview(null);
    setCursor(null);
    setWireFrom(null);
  }

  return (
    <div
      className="qd-logic-stage"
      onKeyDown={(event) => {
        if (event.key === "Escape") cancel();
      }}
    >
      <div className="qd-logic-stage-scroll" ref={frame} aria-label="灵感画布" tabIndex={0}>
        {!board.nodes.length ? (
          <div className="qd-logic-stage-empty">
            <div className="qd-logic-empty-symbol" aria-hidden="true">
              <Icon name="bulb" size={27} />
              <i />
              <Icon name="link" size={23} />
            </div>
            <h3>先放入一个灵感</h3>
            <p>从笔记提炼观点，或自己写一个。从卡片右侧的圆点连到下一步。</p>
            <button type="button" onClick={insert}>
              <Icon name="plus" size={16} />
              从笔记提炼
            </button>
          </div>
        ) : (
          <div
            className="qd-logic-stage-size"
            style={{ width: width * scale, height: height * scale }}
          >
            <div
              ref={surface}
              className="qd-logic-stage-world"
              style={{ width, height, transform: `scale(${scale})` }}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={cancel}
            >
              <svg width={width} height={height} aria-hidden="true" className="qd-logic-wires">
                <defs>
                  {["idle", "active"].map((state) => (
                    <marker
                      key={state}
                      id={marker + state}
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto"
                    >
                      <path className={"qd-logic-arrow " + state} d="M 0 1 L 10 5 L 0 9 z" />
                    </marker>
                  ))}
                </defs>
                {board.links.map((edge) => {
                  const from = nodes.get(edge.from),
                    to = nodes.get(edge.to);
                  if (!from || !to) return null;
                  const { d } = wirePath(output(from), input(to));
                  const active = selection?.kind === "link" && selection.id === edge.id;
                  return (
                    <g
                      key={edge.id}
                      data-edge={edge.id}
                      onClick={() => select({ kind: "link", id: edge.id })}
                    >
                      <path
                        className={"qd-logic-wire " + (active ? "active" : "")}
                        d={d}
                        markerEnd={"url(#" + marker + (active ? "active" : "idle") + ")"}
                      />
                      <path className="qd-logic-wire-hit" d={d} />
                    </g>
                  );
                })}
                {cursor && wireFrom && nodes.has(wireFrom) && (
                  <path
                    className="qd-logic-wire preview"
                    d={wirePath(output(nodes.get(wireFrom)!), cursor).d}
                  />
                )}
              </svg>
              {board.links.map((edge) => {
                const from = nodes.get(edge.from),
                  to = nodes.get(edge.to);
                if (!from || !to) return null;
                const { label } = wirePath(output(from), input(to));
                return (
                  <button
                    type="button"
                    className="qd-logic-wire-label"
                    data-active={selection?.kind === "link" && edge.id === selection.id}
                    key={edge.id}
                    style={{ left: label.x, top: label.y }}
                    onClick={() => select({ kind: "link", id: edge.id })}
                    aria-label={`${notes.get(edge.from)?.title} → ${edge.label || "接着"} → ${notes.get(edge.to)?.title}`}
                  >
                    {edge.label || "接着"}{" "}
                    <span aria-hidden="true">{to.x < from.x ? "‹" : "›"}</span>
                  </button>
                );
              })}
              {Array.from(nodes.values(), (node) => {
                const id = node.noteId,
                  note = notes.get(id),
                  title = note?.title || "原笔记已移除";
                const active = selection?.kind === "note" && selection.id === id;
                return (
                  <div
                    key={id}
                    className="qd-logic-node"
                    data-selected={active}
                    data-source={wireFrom === id}
                    style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
                  >
                    <button
                      type="button"
                      className="qd-logic-port incoming"
                      data-input={id}
                      aria-label={"连入「" + title + "」"}
                      title={"连入「" + title + "」"}
                      onClick={() =>
                        wireFrom ? connect(wireFrom, id) : select({ kind: "note", id })
                      }
                    />
                    <button
                      type="button"
                      className="qd-logic-node-main"
                      data-drag-note={id}
                      aria-label={"画布" + (node.idea ? "灵感" : "笔记") + "「" + title + "」"}
                      onClick={() =>
                        wireFrom && wireFrom !== id
                          ? connect(wireFrom, id)
                          : select({ kind: "note", id })
                      }
                      onKeyDown={(e) => {
                        const delta: Record<string, CanvasPoint> = {
                          ArrowLeft: { x: -16, y: 0 },
                          ArrowRight: { x: 16, y: 0 },
                          ArrowUp: { x: 0, y: -16 },
                          ArrowDown: { x: 0, y: 16 },
                        };
                        const step = delta[e.key];
                        if (step) {
                          e.preventDefault();
                          void move(id, {
                            x: Math.max(12, node.x + step.x),
                            y: Math.max(12, node.y + step.y),
                          });
                        }
                      }}
                    >
                      {note?.note ? <NoteThumbnail note={note.note} /> : <Icon name={node.idea?.origin === "reference" ? "link" : "bulb"} size={17}/>}
                      <span>
                        <small>{note?.typeLabel || "笔记"}</small>
                        <strong>{title}</strong>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="qd-logic-port outgoing"
                      data-output={id}
                      aria-label={"从「" + title + "」连出"}
                      title={"从「" + title + "」连出"}
                      onClick={(e) => {
                        if (e.detail === 0) setWireFrom(wireFrom === id ? null : id);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {!!board.nodes.length && (
        <div className="qd-logic-zoom" aria-label="画布缩放">
          <button
            aria-label="缩小画布"
            disabled={scale <= 0.6}
            onClick={() => setScale((v) => Math.max(0.6, +(v - 0.2).toFixed(1)))}
          >
            −
          </button>
          <button aria-label="重置画布缩放" onClick={() => setScale(1)}>
            {Math.round(scale * 100)}%
          </button>
          <button
            aria-label="放大画布"
            disabled={scale >= 1.6}
            onClick={() => setScale((v) => Math.min(1.6, +(v + 0.2).toFixed(1)))}
          >
            ＋
          </button>
        </div>
      )}
      {wireFrom && (
        <div role="status" className="qd-logic-connect-tip">
          选择要连接的下一张卡片<button onClick={cancel}>取消连线</button>
        </div>
      )}
    </div>
  );
}
