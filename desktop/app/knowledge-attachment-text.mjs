import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseOfficePreview } from "./office-preview.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exec = promisify(execFile);
const office = { ".docx": "document", ".pptx": "slides", ".xlsx": "spreadsheet" };
const textExt = new Set([
  ".txt",
  ".md",
  ".csv",
  ".tsv",
  ".log",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".diff",
  ".patch",
]);
const images = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".tif",
  ".tiff",
  ".webp",
  ".heic",
  ".bmp",
  ".gif",
]);
const nativeText = `
ObjC.import('Foundation');
function recognize(handler) {
  ObjC.import('Vision');
  const req=$.VNRecognizeTextRequest.alloc.init;
  req.recognitionLevel=0;
  req.usesLanguageCorrection=true;
  req.recognitionLanguages=$(['zh-Hans','en-US']);
  if (!handler.performRequestsError($([req]),null)) throw Error('无法识别图片');
  const lines=[];
  for(let i=0; i<req.results.count; i++) {
    const candidates=req.results.objectAtIndex(i).topCandidates(1);
    if(candidates.count) lines.push(ObjC.unwrap(candidates.objectAtIndex(0).string));
  }
  return lines.join('\\n');
}
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  ObjC.import('Vision');
  if (argv[1] !== 'pdf') {
    const handler=$.VNImageRequestHandler.alloc.initWithURLOptions(url,$.NSDictionary.dictionary);
    return JSON.stringify({text:recognize(handler),partial:true});
  }
  ObjC.import('PDFKit');
  const doc = $.PDFDocument.alloc.initWithURL(url);
  if (!doc || doc.isLocked) throw Error('无法读取 PDF');
  const start=Date.now(), pages=[];
  let partial=false, ocr=false;
  for (let i=0; i<doc.pageCount; i++) {
    if (Date.now()-start>75000) {partial=true;break;}
    const page=doc.pageAtIndex(i);
    let content=ObjC.unwrap(page.string) || '';
    if (!content.trim()) {
      partial=true;
      try {
        const bitmap=page.thumbnailOfSizeForBox($.NSMakeSize(1800,1800),0);
        const handler=$.VNImageRequestHandler.alloc.initWithDataOptions(bitmap.TIFFRepresentation,$.NSDictionary.dictionary);
        content=recognize(handler);
        if(content.trim())ocr=true;
      } catch (_) { /* Other text-bearing pages remain usable. */ }
    }
    if(content.trim()) pages.push('第 '+(i+1)+' 页\\n'+content);
  }
  return JSON.stringify({text:pages.join('\\n\\n'),partial,ocr});
}`;
export async function macAttachmentText(bytes, ext) {
  const dir = await mkdtemp(path.join(tmpdir(), "quandeck-note-text-"));
  try {
    const file = path.join(dir, "input" + ext);
    await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
    const { stdout } = await exec(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", nativeText, file, ext === ".pdf" ? "pdf" : "image"],
      { timeout: 90000, maxBuffer: 16 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function officeText(preview) {
  if (preview.kind === "document")
    return preview.blocks
      .map((b) => (b.kind === "table" ? b.rows.map((c) => c.join("\t")).join("\n") : b.text))
      .join("\n");
  if (preview.kind === "slides")
    return preview.slides
      .map((slide, i) => "第 " + (i + 1) + " 页\n" + slide.join("\n"))
      .join("\n\n");
  return preview.sheets
    .map(
      (sheet) =>
        sheet.name +
        "\n" +
        sheet.rows.map((row) => row.cells.map((c) => c?.text ?? "").join("\t")).join("\n"),
    )
    .join("\n\n");
}

export function createKnowledgeFileReader({
  readBytes,
  platform = process.platform,
  native = macAttachmentText,
}) {
  const cache = new Map(),
    inFlight = new Map(),
    activeReads = new Set();
  let cachedChars = 0;
  async function load(file) {
    const ext = path.extname(file.name).toLowerCase();
    const apple = ext === ".pdf" || images.has(ext);
    if (!office[ext] && !textExt.has(ext) && !(apple && platform === "darwin"))
      return { status: "unsupported" };
    const bytes = Buffer.from(await readBytes(file.id));
    if (bytes.length !== file.size || (file.sha256 && hash(bytes) !== file.sha256.toLowerCase()))
      throw Error("附件与原始记录不符");
    if (textExt.has(ext)) {
      const bom =
        bytes[0] === 0xff && bytes[1] === 0xfe
          ? "utf-16le"
          : bytes[0] === 0xfe && bytes[1] === 0xff
            ? "utf-16be"
            : "utf-8";
      const text = new TextDecoder(bom, { fatal: true }).decode(bytes);
      return { text, status: text.trim() ? "read" : "empty", method: "文本" };
    }
    if (office[ext]) {
      const text = officeText(parseOfficePreview(bytes, office[ext]));
      // Existing Office preview extracts readable blocks within format-specific limits.
      return { text, status: text.trim() ? "partial" : "empty", method: "Office 文字预览" };
    }
    const result = await native(bytes, ext);
    return {
      ...result,
      status: !result.text.trim() ? "empty" : result.partial ? "partial" : "read",
      method:
        ext === ".pdf" ? (result.ocr ? "PDF 文字与扫描页识别" : "PDF 文字层") : "图片文字识别",
    };
  }
  async function read(file) {
    const key = JSON.stringify([file.id, file.sha256 ?? "", file.size, file.name]);
    if (cache.has(key)) {
      const value = cache.get(key);
      cache.delete(key);
      cache.set(key, value);
      return value;
    }
    if (!inFlight.has(key)) {
      const pending = load(file)
        .then((value) => {
          const chars = value.text?.length ?? 0;
          if (inFlight.get(key) === pending && chars <= 4_000_000) {
            while (cache.size && (cache.size >= 128 || chars + cachedChars > 4_000_000)) {
              const first = cache.keys().next().value;
              cachedChars -= cache.get(first).text?.length ?? 0;
              cache.delete(first);
            }
            cache.set(key, value);
            cachedChars += chars;
          }
          return value;
        })
        .catch(() => ({ status: "failed" }))
        .finally(() => {
          if (inFlight.get(key) === pending) inFlight.delete(key);
        });
      inFlight.set(key, pending);
    }
    return inFlight.get(key);
  }
  function forget(fileId) {
    const prefix = JSON.stringify([fileId]).slice(0, -1) + ",";
    for (const [key, value] of cache)
      if (key.startsWith(prefix)) {
        cachedChars -= value.text?.length ?? 0;
        cache.delete(key);
      }
    for (const key of inFlight.keys()) if (key.startsWith(prefix)) inFlight.delete(key);
    for (const removed of activeReads) removed.add(fileId);
  }
  async function prepare(notes) {
    const augmented = [],
      coverage = [],
      removed = new Set();
    activeReads.add(removed);
    try {
      for (const note of notes) {
        const attachmentSources = [];
        for (const file of note.attachments ?? []) {
          if (removed.has(file.id)) continue;
          const value = await read(file);
          if (removed.has(file.id)) continue;
          coverage.push({
            noteId: note.id,
            fileId: file.id,
            name: file.name,
            status: value.status,
            method: value.method,
          });
          if (value.text?.trim()) attachmentSources.push(["attachment:" + file.id, value.text]);
        }
        augmented.push({ ...note, attachmentSources });
      }
      return { notes: augmented, coverage };
    } finally {
      activeReads.delete(removed);
    }
  }
  async function quote(library, input) {
    const entry = library.agentGraph?.edges
      ?.flatMap((e) => e.anchors ?? [])
      .find(
        (a) =>
          a.noteId === input?.noteId &&
          a.revision === input.revision &&
          a.source === input.source &&
          a.start === input.start &&
          a.end === input.end &&
          a.digest === input.digest &&
          a.source.startsWith("attachment:"),
      );
    const file =
      entry &&
      library.notes
        .find((n) => n.id === entry.noteId && n.revision === entry.revision)
        ?.attachments.find((f) => "attachment:" + f.id === entry.source);
    if (!file) throw Error("附件来源已变化");
    const { text } = await read(file),
      quote = text?.slice(entry.start, entry.end);
    if (!quote || hash(quote) !== entry.digest) throw Error("附件原文无法核对");
    return quote;
  }
  return { prepare, quote, forget };
}
