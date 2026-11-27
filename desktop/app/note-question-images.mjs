import { createHash } from "node:crypto";

const imageRef = /!\[[^\]\n]*\]\(attachment:([\w-]+)\)/gu;
const maxBytes = 8 * 1024 * 1024;
const maxImages = 4;
const numbers = /^\s*(?:~~)?(\d+)[.)、．）]\s*/u;
const bullet = /^\s*[-*+]\s+/u;

export function requestsNoteImages(question) {
  if (
    /(?:不用|不必|无需|不要|别).{0,8}(?:看|读|识别|分析|描述).{0,12}(?:图片|截图|照片|附件图)/u.test(
      question,
    )
  )
    return false;
  return /(?:读图|看图说|识图)|(?:看|读|识别|辨认|描述|解释|解读|分析|比较|检查|核对|提取).{0,30}(?:截图|照片|图片|配图|这张图|附图|图中|图里)|(?:截图|照片|图片|配图|这张图|附图|图中|图里).{0,22}(?:什么|写[的了着]|文字|显示|颜色|内容|几种|几个|几只|几何|区别|哪里|哪里错|是什么)/u.test(
    question,
  );
}

function listBlocks(note) {
  const blocks = [];
  const todoLines = new Set(
    (note.todos ?? []).filter((todo) => !todo.follows).map((todo) => todo.lineIndex),
  );
  let offset = 0,
    block,
    fence = "",
    blank = false;
  for (const [index, line] of note.body.split("\n").entries()) {
    const start = offset;
    offset += line.length + 1;
    const delimiter = line.trimStart().match(/^(`{3,}|~{3,})/u)?.[1];
    if (delimiter) {
      if (!fence) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = "";
      block = undefined;
      continue;
    }
    if (fence) continue;
    if (!line.trim()) {
      blank = true;
      continue;
    }
    const number = line.match(numbers)?.[1];
    if (number || todoLines.has(index) || (bullet.test(line) && !block?.number)) {
      block = { number, start, end: start + line.length };
      blocks.push(block);
    } else if (
      /^\s*#{1,6}\s/u.test(line) ||
      (blank && !/^\s/u.test(line) && !bullet.test(line) && !line.includes("](attachment:"))
    ) {
      block = undefined;
    } else if (block) block.end = start + line.length;
    blank = false;
  }
  return blocks;
}

export function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
}

// The renderer cannot nominate files. Resolve the selected range, requested numbered item,
// and explicitly selected reference passages against the stored note and exact revision.
export async function readNoteQuestionImages(input, library, readAttachment, tool) {
  if (!requestsNoteImages(input.question)) return [];
  if (tool !== "codex") throw Error("这个连接暂未支持笔记图片输入，请选用 Codex 连接后再读图。");
  const active =
    library?.notes.filter((n) => !n.archivedAt && !library.deletedNoteIds?.includes(n.id)) ?? [];
  const current = active.find((n) => n.id === input.noteId);
  const files = new Map();
  function collect(note, source) {
    for (const match of source.matchAll(imageRef)) {
      const file = note.attachments?.find((entry) => entry.id === match[1]);
      if (!file) throw Error("原文引用的图片附件已移除，请重新选择。");
      files.set(note.id + "\n" + file.id, { file, noteId: note.id, title: note.title });
    }
  }
  const named = [...new Set(Array.from(input.question.matchAll(/《([^》]+)》/gu), (m) => m[1]))];
  const requested = [
    ...new Set(Array.from(input.question.matchAll(/第\s*(\d+)\s*[条项号]/gu), (m) => m[1])),
  ];
  let selected;
  if (
    current &&
    input.revision === current.revision &&
    Number.isSafeInteger(input.selection?.offset) &&
    input.selection.offset >= 0 &&
    current.body.slice(
      input.selection.offset,
      input.selection.offset + input.selection.quote.length,
    ) === input.selection.quote
  ) {
    selected = {
      start: input.selection.offset,
      end: input.selection.offset + input.selection.quote.length,
    };
  }
  const referencesOnly = /(?:仅|只)(?:看|读|识别|分析|描述|比较)?(?:所选)?(?:参考|引用)/u.test(
    input.question,
  );
  const scopes = named.length
    ? named.map((title) => {
        const matches = active.filter((n) => n.title === title);
        if (matches.length !== 1)
          throw Error("读图笔记的标题重复或已变化，请打开目标笔记并重新选择。");
        return matches[0];
      })
    : [current];
  if (requested.length && !referencesOnly) {
    for (const note of scopes) {
      if (!note || (note === current && !selected))
        throw Error("选段或笔记版本已变化，请先保存并重新选择读图条目。");
      for (const number of requested) {
        const candidates = listBlocks(note).filter((b) => b.number === number);
        const picked =
          candidates.length === 1
            ? candidates[0]
            : note === current &&
              selected &&
              candidates.find((b) => selected.start >= b.start && selected.start <= b.end);
        if (!picked) throw Error("找不到唯一的第" + number + "条，请选中目标条目的文字后读图。");
        collect(note, note.body.slice(picked.start, picked.end));
      }
    }
  } else if (selected && scopes.includes(current) && !referencesOnly) {
    collect(current, current.body.slice(selected.start, selected.end));
    if (!files.size) {
      const containing = listBlocks(current).find(
        (b) => selected.start >= b.start && selected.end <= b.end,
      );
      if (containing) collect(current, current.body.slice(containing.start, containing.end));
    }
  }
  for (const ref of input.memoryRefs ?? []) {
    if (ref.kind !== "passage") continue;
    const note = active.find((n) => n.id === ref.noteId && n.revision === ref.revision);
    if (
      !note ||
      !Number.isSafeInteger(ref.start) ||
      !Number.isSafeInteger(ref.end) ||
      ref.start < 0 ||
      ref.end <= ref.start ||
      ref.end > note.body.length
    )
      throw Error("读图参考选段已变化，请重新选择。");
    if (!named.length || scopes.includes(note)) collect(note, note.body.slice(ref.start, ref.end));
  }
  if (!files.size)
    throw Error("所选原文、条目或参考选段中没有可读取的笔记图片。请保存后选择图片所在条目。");
  if (files.size > maxImages) throw Error("每次最多读取 4 张图片，请缩小选择范围。");
  if (!readAttachment) throw Error("当前客户端未连接图片存储。");
  let total = 0;
  const images = [];
  for (const { file, noteId, title } of files.values()) {
    total += file.size;
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || total > maxBytes)
      throw Error("此次笔记读图合计最多支持 8 MB，请缩小图片或选择范围。");
    const bytes = Buffer.from(await readAttachment(file.id));
    const type = imageType(bytes);
    if (
      bytes.length !== file.size ||
      (file.sha256 && createHash("sha256").update(bytes).digest("hex") !== file.sha256)
    )
      throw Error("图片内容与已保存的版本不一致，请重新选择。");
    if (!type || type !== file.type) throw Error("附件不是可读取的 PNG、JPEG、GIF 或 WebP 图片。");
    images.push({
      noteId,
      id: file.id,
      name: file.name,
      title,
      url: "data:" + type + ";base64," + bytes.toString("base64"),
    });
  }
  return images;
}
