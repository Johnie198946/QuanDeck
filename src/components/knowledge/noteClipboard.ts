import { desktopHost } from "../../integration/desktop";

function tsvRows(text: string): string[][] | undefined {
  if (!text.includes("\t")) return;
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  const input = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"' && quoted && input[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (c === '"' && (quoted || !cell)) quoted = !quoted;
    else if (!quoted && (c === "\t" || c === "\n")) {
      row.push(cell);
      cell = "";
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else cell += c;
  }
  if (quoted) return;
  if (row.length || cell) rows.push([...row, cell]);
  return rows.length && rows[0].length > 1 && rows.every((r) => r.length === rows[0].length)
    ? rows
    : undefined;
}

function htmlRows(table: HTMLTableElement) {
  const rows: string[][] = [];
  const count = table.rows.length;
  let allocated = 0;
  for (const [r, tr] of Array.from(table.rows).entries()) {
    const row = (rows[r] ??= []);
    let c = 0;
    for (const cell of tr.cells) {
      while (row[c] !== undefined) c++;
      const height = Math.min(cell.rowSpan || count, count - r),
        width = cell.colSpan;
      allocated += height * width;
      if (allocated > 10000) throw Error("表格较大，请分段粘贴。");
      for (let y = 0; y < height; y++) {
        const target = (rows[r + y] ??= []);
        for (let x = 0; x < width; x++) target[c + x] = "";
      }
      const copy = cell.cloneNode(true) as HTMLElement;
      copy.querySelectorAll("style,script,template").forEach((el) => el.remove());
      copy.querySelectorAll("br").forEach((el) => el.replaceWith(" "));
      row[c] = copy.textContent?.trim() || "";
      c += width;
    }
  }
  return rows;
}

// Rebuild a plain editable table. Pasted event handlers, embedded objects and external images never enter the note.
export function clipboardTables(data: DataTransfer): string | undefined {
  const html = data.getData("text/html");
  let tables: string[][][] = [];
  let template: HTMLTemplateElement | undefined;
  let originals: HTMLTableElement[] = [];
  if (/<table\b/i.test(html)) {
    template = document.createElement("template");
    template.innerHTML = html;
    template.content
      .querySelectorAll("head,style,script,template,link,meta,iframe,object")
      .forEach((el) => el.remove());
    originals = Array.from(template.content.querySelectorAll("table")).filter(
      (t) => !t.parentElement?.closest("table"),
    );
    tables = originals.map(htmlRows);
  }
  if (!tables.length) {
    const tsv = tsvRows(data.getData("text/plain"));
    if (!tsv) return;
    tables = [tsv];
  }
  let total = 0;
  const parts: string[] = [];
  for (const rows of tables) {
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    total += width * rows.length;
    if (total > 10000) throw Error("表格较大，请分段粘贴。");
    if (!width) {
      parts.push("");
      continue;
    }
    const table = document.createElement("table");
    const header = table.createTHead(),
      body = table.createTBody();
    rows.forEach((row, index) => {
      const tr = (index ? body : header).insertRow();
      for (let col = 0; col < width; col++) {
        const td = document.createElement(index ? "td" : "th");
        td.textContent = (row[col] ?? "").replace(/\s*\n\s*/g, " ");
        if (!td.textContent) td.append(document.createElement("br"));
        tr.append(td);
      }
    });
    parts.push(table.outerHTML);
  }
  if (!parts.some(Boolean)) return;
  if (template && originals.length) {
    const rebuilt = new Map(originals.map((el, index) => [el, parts[index]]));
    function safeContent(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = document.createElement("span");
        text.textContent = node.textContent;
        return text.innerHTML;
      }
      if (node instanceof HTMLTableElement) return rebuilt.get(node) ?? "";
      if (node.nodeType === Node.COMMENT_NODE) return "";
      if (node instanceof Element && node.tagName === "BR") return "<br>";
      const body = Array.from(node.childNodes).map(safeContent).join("");
      if (
        node instanceof Element &&
        ["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6"].includes(node.tagName)
      )
        return "<p>" + body + "</p>";
      return body;
    }
    return safeContent(template.content) + "<p><br></p>";
  }
  return parts.join("<p><br></p>") + "<p><br></p>";
}

export function selectedNoteImage(root: HTMLElement | null) {
  const selection = window.getSelection();
  if (!root || !selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer) || range.toString().trim()) return;
  const images = range.cloneContents().querySelectorAll<HTMLImageElement>("img[data-note-image]");
  if (images.length === 1) return images[0];
}

async function clipboardPng(image: HTMLImageElement) {
  const src = image.getAttribute("src");
  if (!src || !src.startsWith("blob:")) throw Error("请等图片加载完成，再复制。");
  const blob = await (await fetch(src)).blob();
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("无法读取图片");
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(Error("无法转换图片"))),
        "image/png",
      ),
    );
  } finally {
    bitmap.close();
  }
}

export async function copyNoteImage(image: HTMLImageElement) {
  const host = desktopHost();
  if (host?.copyKnowledgeImage) {
    const png = await clipboardPng(image);
    await host.copyKnowledgeImage(await png.arrayBuffer());
  } else {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
      throw Error("当前环境无法写入图片剪贴板");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": clipboardPng(image) })]);
  }
}
