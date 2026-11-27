import { memo, useState } from "react";
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

export const NoteAnswerBody = memo(function NoteAnswerBody({
  text,
  imageUrls,
}: {
  text: string;
  imageUrls: ReadonlyMap<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  // Keep the original Markdown (including tables and fenced code) intact in the full view.
  const paragraphs = text.trim().split(/\n\s*\n/);
  const first = paragraphs.find((p) => p.trim() && !/^\s*(?:[#|>\x60~]|[-*+] |\d+[.)] )/u.test(p));
  const preview =
    text.length > 600 && first && first.length <= 380 && paragraphs.length > 1 ? first : undefined;
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
            img: ({ src, alt }) => {
              const url =
                typeof src === "string" && src.startsWith("attachment:")
                  ? imageUrls.get(src.slice(11))
                  : undefined;
              return url ? <img src={url} alt={alt ?? "笔记插图"} /> : <span>{alt}</span>;
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
