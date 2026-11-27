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
  // Some spreadsheet apps omit the trailing tabs of empty cells.
  return rows.some(r => r.length > 1) ? rows : undefined;
}

// Markdown copied from a chat or a document can arrive as plain text only.
// Require the divider row so prose containing a vertical bar stays prose.
function markdownRows(text: string): string[][] | undefined {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2 || !lines[0].includes("|") || !lines[1].includes("|")) return;
  const split = (line: string) => line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));
  const header = split(lines[0]);
  const divider = split(lines[1]);
  if (header.length !== divider.length || !divider.every(cell => /^:?-{1,}:?$/.test(cell))) return;
  if (!lines.slice(2).every(line => line.includes("|"))) return;
  return [header, ...lines.slice(2).map(split)];
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
  let html = data.getData("text/html");
  // Copying a selection of cells may omit the containing table and row.
  if (html && !/<table\b/i.test(html) && /<(?:tr|th|td)\b/i.test(html)) {
    html = /<tr\b/i.test(html) ? "<table>" + html + "</table>" : "<table><tr>" + html + "</tr></table>";
  }
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
    const plain = data.getData("text/plain");
    const rows = tsvRows(plain) ?? markdownRows(data.getData("text/markdown") || plain);
    if (!rows) return;
    tables = [rows];
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

// Paste into an existing grid starting at the caret cell. Replacing the table
// with one edit keeps Undo atomic and avoids serializing a table inside a cell.
export function insertClipboardTable(root: HTMLElement, html: string) {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  const cell = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest("td,th");
  const table = cell?.closest("table");
  if (cell instanceof HTMLTableCellElement && table instanceof HTMLTableElement && root.contains(table) && selection) {
    const fragment = document.createElement("template");
    fragment.innerHTML = html;
    const source = fragment.content.querySelector("table");
    const remainder = fragment.content.cloneNode(true) as DocumentFragment;
    remainder.querySelector("table")?.remove();
    const range = document.createRange();
    // Mixed prose and tables belong after the grid instead of inside a cell.
    range.selectNode(table);
    if (source && !remainder.textContent?.trim() && remainder.querySelector("table") === null) {
      const target = table.cloneNode(true) as HTMLTableElement;
      const startRow = (cell.parentElement as HTMLTableRowElement).rowIndex;
      const startCol = cell.cellIndex;
      const width = Math.max(...Array.from(target.rows,r => r.cells.length), startCol + source.rows[0].cells.length);
      const height = Math.max(target.rows.length, startRow + source.rows.length);
      if (height * width > 10_000) throw Error("表格较大，请分段粘贴。");
      for (let row = 0; row < height; row++) {
        const tr = target.rows[row] ?? (target.tBodies[0] ?? target.createTBody()).insertRow();
        while (tr.cells.length < width) tr.append(document.createElement(row === 0 ? "th" : "td"));
      }
      for (const [r, tr] of Array.from(source.rows).entries()) {
        Array.from(tr.cells).forEach((value, c) => {
          target.rows[startRow + r].cells[startCol + c].replaceChildren(...value.childNodes);
        });
      }
      html = target.outerHTML;
    } else range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  if (!document.execCommand("insertHTML", false, html)) throw Error("粘贴失败，请点击正文后再试。");
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
    try { await host.copyKnowledgeImage(await png.arrayBuffer()); }
    catch { throw Error("图片未能写入剪贴板，请重试。"); }
  } else {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
      throw Error("当前环境无法写入图片剪贴板");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": clipboardPng(image) })]);
  }
}
