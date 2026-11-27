import type { OutputAttachment } from "./types";

export interface IdeaSource {
  noteId: string;
  revision: number;
  field: "body" | "title";
  start: number;
  end: number;
  digest: string;
}
export type IdeaReference = { url: string } | { file: OutputAttachment };
export interface CanvasIdea {
  title: string;
  detail: string;
  origin: "extracted" | "manual" | "reference";
  source?: IdeaSource;
  reference?: IdeaReference;
}
export interface IdeaCard { id: string; idea: CanvasIdea }

export interface CanvasPoint {
  x: number;
  y: number;
}
export interface InspirationNode extends CanvasPoint {
  // Existing files use noteId as their stable node and connection key.
  noteId: string;
  idea?: CanvasIdea;
}
export interface InspirationLink {
  id: string;
  from: string;
  to: string;
  label: string;
  detail: string;
  reverseDetail: string;
}
export interface InspirationBoard {
  nodes: InspirationNode[];
  links: InspirationLink[];
}
export const emptyInspirationBoard = (): InspirationBoard => ({ nodes: [], links: [] });

function isCanvasIdea(idea: CanvasIdea): boolean {
  if (!idea || typeof idea.title !== "string" || !idea.title.trim() || typeof idea.detail !== "string") return false;
  if (idea.origin === "manual") return true;
  if (idea.origin === "reference") {
    const ref = idea.reference;
    if (!ref) return false;
    if ("url" in ref) {
      try {
        const url = new URL(ref.url);
        return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
      } catch { return false; }
    }
    const file = ref.file;
    return !!file && typeof file.id === "string" && typeof file.name === "string" && typeof file.type === "string" && Number.isSafeInteger(file.size) && file.size >= 0;
  }
  const src = idea.source;
  return idea.origin === "extracted" && !!src && typeof src.noteId === "string" && Number.isSafeInteger(src.revision) &&
    ["title", "body"].includes(src.field) && Number.isInteger(src.start) && Number.isInteger(src.end) &&
    src.start >= 0 && src.end > src.start && /^[a-f0-9]{64}$/.test(src.digest);
}

export function isInspirationBoard(value: unknown): value is InspirationBoard {
  if (
    !value ||
    typeof value !== "object" ||
    !("nodes" in value) ||
    !Array.isArray(value.nodes) ||
    !("links" in value) ||
    !Array.isArray(value.links)
  )
    return false;
  const nodeIds = new Set<string>();
  for (const node of value.nodes) {
    if (
      typeof node?.noteId !== "string" ||
      nodeIds.has(node.noteId) ||
      (node.idea !== undefined && !isCanvasIdea(node.idea)) ||
      !Number.isFinite(node.x) ||
      !Number.isFinite(node.y) ||
      node.x < 0 ||
      node.y < 0
    )
      return false;
    nodeIds.add(node.noteId);
  }
  const edgeIds = new Set<string>();
  const directions = new Set<string>();
  for (const edge of value.links) {
    if (
      !edge ||
      typeof edge.id !== "string" ||
      edgeIds.has(edge.id) ||
      edge.from === edge.to ||
      !nodeIds.has(edge.from) ||
      !nodeIds.has(edge.to) ||
      typeof edge.label !== "string" ||
      typeof edge.detail !== "string" ||
      typeof edge.reverseDetail !== "string"
    )
      return false;
    const pair = JSON.stringify([edge.from, edge.to]);
    if (directions.has(pair)) return false;
    directions.add(pair);
    edgeIds.add(edge.id);
  }
  return true;
}

export const NODE_WIDTH = 184;
export const NODE_HEIGHT = 80;

export function insertInspiration(board: InspirationBoard, noteId: string, idea?: CanvasIdea) {
  if (idea && !isCanvasIdea(idea)) throw new Error("灵感缺少内容或来源");
  if (board.nodes.some((node) => node.noteId === noteId)) return;
  // Pick an unoccupied slot, including after notes have been moved or removed.
  for (let index = 0; ; index++) {
    const col = index % 3;
    const x = 36 + col * (NODE_WIDTH + 96);
    const y = 112 + Math.floor(index / 3) * 170 + (col % 2) * 96;
    if (
      board.nodes.every(
        (node) =>
          Math.abs(node.x - x) >= NODE_WIDTH + 16 || Math.abs(node.y - y) >= NODE_HEIGHT + 16,
      )
    ) {
      board.nodes.push({ noteId, x, y, ...(idea && { idea }) });
      return;
    }
  }
}

export function removeInspiration(board: InspirationBoard, noteId: string) {
  board.nodes = board.nodes.filter((node) => node.noteId !== noteId);
  board.links = board.links.filter((edge) => edge.from !== noteId && edge.to !== noteId);
}

export function connectInspirations(board: InspirationBoard, from: string, to: string) {
  if (from === to) throw new Error("请选择另一张卡片。");
  if (![from, to].every((id) => board.nodes.some((node) => node.noteId === id)))
    throw new Error("这张卡片已从画布移除。");
  const existing = board.links.find((link) => link.from === from && link.to === to);
  if (existing) return existing;
  const link: InspirationLink = {
    id: crypto.randomUUID(),
    from,
    to,
    label: "接着",
    detail: "",
    reverseDetail: "",
  };
  board.links.push(link);
  return link;
}

export function reverseInspiration(board: InspirationBoard, id: string) {
  const edge = board.links.find((link) => link.id === id);
  if (!edge) return;
  if (board.links.some((link) => link.from === edge.to && link.to === edge.from))
    throw new Error("反方向已有连线，可选中那条线查看。");
  [edge.from, edge.to] = [edge.to, edge.from];
  [edge.detail, edge.reverseDetail] = [edge.reverseDetail, edge.detail];
}

export function describeInspiration(from: string, to: string, label: string) {
  switch (label.trim()) {
    case "前往":
      return "先按「" + from + "」游玩，再前往「" + to + "」继续行程。";
    case "参考":
      return "处理「" + from + "」时，参考「" + to + "」里的做法。";
    case "补充":
      return "用「" + from + "」里的内容，补充「" + to + "」。";
    case "":
    case "接着":
      return "先做「" + from + "」，接着做「" + to + "」。";
    default:
      return "从「" + from + "」出发，通过「" + label.trim() + "」衔接「" + to + "」。";
  }
}
