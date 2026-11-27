import { isValidElement, memo, useState } from "react";
import type { KnowledgeLibrary, NoteExpansion } from "../../data/knowledgeNotes";
import type { OutputAttachment } from "../../data/types";
import { DeferredNoteImage } from "./NoteThumbnail";
import { NoteAnswerChart, readNoteChart } from "./NoteAnswerChart";
import { FigureCode } from "../runtime/FigureCode";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

type AnswerNode = {
  type: string;
  value?: string;
  children?: AnswerNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

// Some agents leave a space just before the closing bold marker. GFM emits this
// as literal text. Repair only that case in prose, preserving code and escaped examples.
function answerEmphasis() {
  return (root: AnswerNode, file: { toString(): string }) => {
    const original = file.toString();
    function visit(node: AnswerNode) {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value) {
          visit(child);
          return [child];
        }
        if (!child.value.includes("**") || !child.position) return [child];
        const raw = original.slice(child.position.start.offset, child.position.end.offset);
        if (raw.includes("\\*")) return [child];
        const parts: AnswerNode[] = [];
        let cursor = 0;
        for (const hit of child.value.matchAll(/\*\*([^*\n]+?\S)[ \t]+\*\*/gu)) {
          const index = hit.index!;
          if (index > cursor) parts.push({ type: "text", value: child.value.slice(cursor, index) });
          parts.push({ type: "strong", children: [{ type: "text", value: hit[1].trim() }] });
          cursor = index + hit[0].length;
        }
        if (!parts.length) return [child];
        if (cursor < child.value.length)
          parts.push({ type: "text", value: child.value.slice(cursor) });
        return parts;
      });
    }
    visit(root);
  };
}

function RemoteNoteImage({ src, alt }: { src: string; alt: string }) {
  const [phase, setPhase] = useState<"idle" | "load" | "failed">("idle");
  if (phase === "load")
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setPhase("failed")}
      />
    );
  return (
    <button type="button" className="qd-link" onClick={() => setPhase("load")}>
      {phase === "failed" ? "重新加载图片" : "加载图片"} · {alt}
    </button>
  );
}

export const NoteAnswerBody = memo(function NoteAnswerBody({
  text,
  imageUrls,
  noteId,
  files,
  full = false,
  expansion,
  library,
}: {
  text: string;
  noteId?: string;
  files?: OutputAttachment[];
  full?: boolean;
  expansion?: NoteExpansion;
  library?: KnowledgeLibrary;
  imageUrls: ReadonlyMap<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  // Keep the original Markdown (including tables and fenced code) intact in the full view.
  const paragraphs = text.trim().split(/\n\s*\n/);
  const first = paragraphs.find((p) => p.trim() && !/^\s*(?:[#|>\x60~]|[-*+] |\d+[.)] )/u.test(p));
  const preview =
    !full &&
    !/(?:!\[[^\]]*\]\(|^`{3,}quandeck-(?:chart|flow)\b)/m.test(text) &&
    text.length > 600 &&
    first &&
    first.length <= 380 &&
    paragraphs.length > 1
      ? first
      : undefined;
  return (
    <div className="qd-answer-reading">
      <div className="qd-answer-content">
        <ReactMarkdown
          skipHtml
          remarkPlugins={[remarkGfm, answerEmphasis]}
          urlTransform={(url, key) =>
            key === "src" && /^attachment:[a-z0-9-]+$/i.test(url) ? url : defaultUrlTransform(url)
          }
          components={{
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
            pre: ({ children }) => {
              if (
                isValidElement<{ className?: string; children?: unknown }>(children) &&
                children.props.className === "language-quandeck-chart" &&
                typeof children.props.children === "string"
              ) {
                const chart = readNoteChart(children.props.children);
                if (
                  chart &&
                  expansion?.workspace?.noteList &&
                  chart.series.length === 1 &&
                  chart.labels.length === 3
                ) {
                  const states = chart.labels.map((label) => {
                    if (/部分|半|partial/i.test(label)) return "partial";
                    if (/未划|未画|没划|没画|未完成|open/i.test(label)) return "open";
                    if (/已划|已画|全部划|完全划|已完成|struck/i.test(label)) return "struck";
                    return "";
                  });
                  // The source card already plots these three verified categories.
                  if (
                    states.includes("open") &&
                    states.includes("partial") &&
                    states.includes("struck")
                  )
                    return null;
                }
                if (chart) return <NoteAnswerChart chart={chart} />;
              }
              return <FigureCode>{children}</FigureCode>;
            },
            img: ({ src, alt }) => {
              const label = alt || "笔记插图";
              if (typeof src === "string" && /^https:\/\//i.test(src))
                return <RemoteNoteImage key={src} src={src} alt={label} />;
              const id =
                typeof src === "string" && src.startsWith("attachment:") ? src.slice(11) : "";
              const url = imageUrls.get(id);
              if (url) return <img src={url} alt={label} loading="lazy" decoding="async" />;
              const local = files?.find(
                (file) => file.id === id && file.type?.startsWith("image/"),
              );
              if (local && noteId)
                return <DeferredNoteImage key={id} noteId={noteId} file={local} alt={label} />;
              if (expansion && library && id) {
                const reads = [expansion.workspace, ...(expansion.additionalReads ?? [])];
                const entry = reads
                  .flatMap((read) => read?.noteList?.items ?? [])
                  .find((item) => item.images.some((img) => img.id === id));
                const candidates = entry
                  ? library.notes.filter((note) => note.id === entry.noteId)
                  : expansion.sourceIds?.includes("attachment:" + id)
                    ? library.notes.filter((note) =>
                        note.attachments.some((file) => file.id === id),
                      )
                    : [];
                const source = candidates.length === 1 ? candidates[0] : undefined;
                const picture =
                  source &&
                  source.attachments.find((f) => f.id === id && f.type?.startsWith("image/"));
                if (source && picture)
                  return (
                    <DeferredNoteImage
                      key={source.id + id}
                      noteId={source.id}
                      file={picture}
                      alt={label}
                    />
                  );
              }
              return <span>{label}（图片不可用）</span>;
            },
            table: ({ children }) => (
              <div className="qd-answer-table" tabIndex={0} role="region" aria-label="回答表格">
                <table>{children}</table>
              </div>
            ),
          }}
        >
          {preview && !expanded ? preview : text}
        </ReactMarkdown>
      </div>
      {preview && (
        <button
          type="button"
          className="qd-link qd-answer-fold"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起回答" : "展开完整回答"}
        </button>
      )}
    </div>
  );
});
