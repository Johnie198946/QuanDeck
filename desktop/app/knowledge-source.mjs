import { lookup as resolveDns } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { isAnalysisReceipt } from './knowledge-graph-agent.mjs';

const privateV4 = new BlockList();
for (const [network, bits] of [
  ['0.0.0.0',8], ['10.0.0.0',8], ['100.64.0.0',10], ['127.0.0.0',8], ['169.254.0.0',16],
  ['172.16.0.0',12], ['192.0.0.0',24], ['192.0.2.0',24], ['192.88.99.0',24], ['192.168.0.0',16],
  ['198.18.0.0',15], ['198.51.100.0',24], ['203.0.113.0',24], ['224.0.0.0',4], ['240.0.0.0',4],
]) privateV4.addSubnet(network, bits, 'ipv4');
const publicV6 = new BlockList();
publicV6.addSubnet('2000::', 3, 'ipv6');
const privateV6 = new BlockList();
for (const [network, bits] of [['2001::',23], ['2001:db8::',32], ['2002::',16], ['3fff::',20]]) privateV6.addSubnet(network,bits,'ipv6');

export function isPublicAddress(address) {
  const version = isIP(address);
  return version === 4 ? !privateV4.check(address, 'ipv4')
    : version === 6 && publicV6.check(address, 'ipv6') && !privateV6.check(address, 'ipv6');
}

export function publicKnowledgeUrl(value) {
  const url = new URL(value);
  // Plain public document links are accepted. Query URLs can contain sign-in or access tokens.
  if (url.protocol !== 'https:' || url.port || url.search || url.username || url.password || url.href.length > 2048) {
    throw new Error('只读取无需登录的公开 HTTPS 文章');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostname.includes('.') || isIP(hostname) || /(?:^|\.)(?:local|localhost|internal|lan|test|invalid|onion)\.?$/i.test(hostname)) {
    throw new Error('不读取本机或内部地址');
  }
  url.hash = '';
  return url;
}

const maximum = 768 * 1024;
const redirects = new Set([301, 302, 303, 307, 308]);
function waitForAddress(hostname, signal) {
  let reject, promise = new Promise((_, fail) => { reject = fail; });
  const abort = () => reject(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  return Promise.race([resolveDns(hostname, { all: true, verbatim: true }), promise])
    .finally(() => signal.removeEventListener('abort', abort));
}

function getTextPage(url, addresses, signal) {
  return new Promise((resolve, reject) => {
    // Resolve once per hop. Pin the actual socket to those addresses and preserve TLS hostname validation.
    const get = request(url, {
      agent: false,
      lookup: (hostname, options, callback) => options.all
        ? callback(null, addresses)
        : callback(null, addresses[0].address, addresses[0].family),
      signal,
      headers: { Accept: 'text/html,text/plain', 'Accept-Encoding': 'identity', 'User-Agent': 'QuanDeck resource reader' },
    }, response => {
      const status = response.statusCode;
      if (redirects.has(status) && typeof response.headers.location === 'string') {
        response.destroy();
        resolve({ redirect: response.headers.location });
        return;
      }
      const type = String(response.headers['content-type'] ?? '').toLowerCase();
      const encoding = String(response.headers['content-encoding'] ?? 'identity').toLowerCase();
      if (status !== 200 || !/^text\/(html|plain)(?:;|$)/i.test(type) || encoding !== 'identity' || Number(response.headers['content-length'] ?? 0) > maximum) {
        response.destroy();
        reject(new Error('来源暂不可读取，或正文格式不支持'));
        return;
      }
      let size = 0;
      const buffers = [];
      response.on('data', bytes => {
        size += bytes.length;
        if (size > maximum) response.destroy(new Error('来源正文超过大小上限'));
        else buffers.push(bytes);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ type, text: Buffer.concat(buffers).toString('utf8') }));
    });
    get.on('error', reject);
    get.end();
  });
}

const entities = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeText(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (token, value) => {
    if (!value.startsWith('#')) return entities[value.toLowerCase()] ?? token;
    const hex = /^#x/i.test(value);
    const number = Number.parseInt(value.slice(hex ? 2 : 1), hex ? 16 : 10);
    return number >= 32 && number <= 0x10FFFF && !(number >= 0xD800 && number <= 0xDFFF)
      ? String.fromCodePoint(number) : token;
  });
}
function compact(text) { return decodeText(text).replace(/[\u0000-\u0020]+/gu, ' ').trim(); }
const excluded = new Set(['script','style','svg','noscript','template','iframe','nav','footer','aside']);
const lineBreaks = new Set(['p','h1','h2','h3','h4','li','section','div','br','tr']);
export function readableKnowledgeText(type, payload) {
  if (!type.startsWith('text/html')) return { title: '', text: compact(payload).slice(0, 7000) };
  let ignored, section, insideTitle = false, insideHead = false;
  let title = '', main = '', body = '';
  for (const [token] of payload.matchAll(/<!--[\s\S]*?(?:-->|$)|<[^>]{0,4096}>|[^<]{1,4096}|</g)) {
    if (token.startsWith('<')) {
      const mark = /^<(\/)?([a-z0-9]+)/i.exec(token);
      if (!mark) continue;
      const [, closing, rawName] = mark;
      const name = rawName.toLowerCase();
      if (ignored) {
        if (closing && name === ignored) ignored = undefined;
        continue;
      }
      if (!closing && excluded.has(name)) { ignored = name; continue; }
      if (name === 'head') insideHead = !closing;
      if (name === 'title') insideTitle = !closing;
      if (name === 'main' || name === 'article') section = closing ? undefined : name;
      if (!insideHead && lineBreaks.has(name)) {
        if (body.length < 8000) body += '\n';
        if (section && main.length < 8000) main += '\n';
      }
      continue;
    }
    if (ignored) continue;
    if (insideTitle && title.length < 200) title += token;
    if (!insideHead && !insideTitle) {
      if (body.length < 8000) body += token;
      if (section && main.length < 8000) main += token;
    }
  }
  const naturalText = (main.trim() || body).split('\n').map(compact).filter(Boolean).join('\n');
  return { title: compact(title).slice(0, 160), text: naturalText.slice(0, 7000) };
}

export async function readPublicKnowledgeSource(value, { addressesFor = waitForAddress, readPage = getTextPage } = {}) {
  const signal = AbortSignal.timeout(9000);
  let url = publicKnowledgeUrl(value);
  for (let hops = 0; hops <= 3; hops++) {
    signal.throwIfAborted();
    const addresses = await addressesFor(url.hostname, signal);
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('来源不是公开地址');
    const response = await readPage(url, addresses, signal);
    if (response.redirect) {
      url = publicKnowledgeUrl(new URL(response.redirect, url).href);
      continue;
    }
    const content = readableKnowledgeText(response.type, response.text);
    if (content.text.length < 60 || content.text.includes('\ufffd')) throw new Error('没有读取到可引用的正文');
    return { url: url.href, title: content.title || url.hostname, text: content.text, checkedAt: new Date().toISOString() };
  }
  throw new Error('来源跳转过多，未读取');
}

export function noteQuestionPrompt(question, quote, readings = []) {
  const prompt = question + '\n\n' + quote;
  if (!readings.length) return prompt;
  const sources = readings.map(({ url, title, text }, i) => ({ number: i + 1, url, title, text }));
  return prompt + '\n\n以下是用户选择附上的参考资料。引用时保留编号。\n' + JSON.stringify(sources);
}

function selectedMemories(refs = [], library, sourceNoteIds) {
  if (!Array.isArray(refs)) throw Error('所选参考格式无效');
  return refs.map(ref => {
    if (ref?.kind === 'passage') {
      const note=library?.notes.find(n=>n.id===ref.noteId && !n.archivedAt);
      if (!note || ref.revision !== note.revision || !Number.isInteger(ref.start) || !Number.isInteger(ref.end) ||
          ref.start < 0 || ref.end <= ref.start || ref.end > note.body.length) throw Error('参考选段已变化，请重新选择');
      sourceNoteIds.add(note.id);
      return { source:note.id+'@'+note.revision+'#'+ref.start+'-'+ref.end, text:note.body.slice(ref.start,ref.end) };
    }
    if (ref?.kind === 'idea') {
      const item=library?.inspirationCanvas?.nodes.find(n=>n.noteId===ref.nodeId)?.idea;
      if (item && item.title===ref.title && item.detail===ref.detail) {
        if (item.source?.noteId) sourceNoteIds.add(item.source.noteId);
        return {source:'idea:'+ref.nodeId,text:[item.title,item.detail].filter(Boolean).join('\n')};
      }
    }
    throw Error('选中的灵感已变化，请重新选择');
  });
}

function parentChain(parentId, note) {
  const chain=[], seen=new Set();
  while(parentId) {
    const parent=note?.expansions.find(item=>item.id===parentId);
    if(!parent || seen.has(parent.id)) throw Error('上文已删除或不可用，请从原文另提问题');
    seen.add(parent.id); chain.unshift(parent); parentId=parent.parentAnswerId;
  }
  return chain;
}

export async function relayNoteQuestion(input, { projectId, connection, assist, readLibrary, readSource = readPublicKnowledgeSource }) {
  const { requestId, noteId, revision, question, selection, usePublicSources, publicLinks } = input ?? {};
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId) ||
      typeof noteId !== 'string' || !noteId || noteId.length > 256 ||
      typeof selection?.quote !== 'string' || !selection.quote.trim() || selection.quote.length > 6000 ||
      typeof question !== 'string' || !question.trim() || question.length > 1200) {
    throw new Error('请选中文字并输入问题');
  }
  if (!connection || !['codex', 'claude', 'dsh'].includes(connection.tool)) throw new Error('请先在设置中连接 Agent');
  let readings = [];
  if (usePublicSources === true && Array.isArray(publicLinks)) {
    const requests = publicLinks.slice(0, 2).map(async link => readSource(publicKnowledgeUrl(link).href));
    readings = (await Promise.allSettled(requests)).flatMap(item => item.status === 'fulfilled' ? [item.value] : []);
  }
  const library = (input.memoryRefs?.length || input.parentAnswerId) ? readLibrary?.() : undefined;
  const sourceNoteIds = new Set();
  const memories=selectedMemories(input.memoryRefs,library,sourceNoteIds);
  if (input.background !== undefined && typeof input.background !== 'string') throw Error('补充背景格式无效');
  const chain=parentChain(input.parentAnswerId,library?.notes.find(n=>n.id===noteId));
  const last=chain.at(-1);
  const history=chain.map(item=>({question:item.question, answer:item.answer, quote:item.selection.quote,
    ...(item.background && { background:item.background }), ...(item.sources?.length && { sources:item.sources }),
    ...(item.memoryRefs?.length && {references:item.memoryRefs.flatMap(ref=>{
      try { return selectedMemories([ref],library,sourceNoteIds); } catch {return [];}
    })})}));
  const prompt=[noteQuestionPrompt(question, selection.quote, readings),
    input.background?.trim() && '用户补充的背景：\n'+input.background.trim(),
    memories.length && '用户选中的参考资料：\n'+JSON.stringify(memories)].filter(Boolean).join('\n\n');
  const request = { requestId, projectId, connectionId: connection.connectionId, tool: connection.tool,
    kind:'note-question', prompt, noteThread:{noteId, ...(sourceNoteIds.size && {sourceNoteIds:[...sourceNoteIds]}), ...(last && {parentRequestId:last.questionRequestId, history:JSON.stringify(history)})}, timeoutMs:120000 };
  const result = await assist(request);
  const mode = result?.noteConversation ?? 'new';
  const validMode = last ? ['resumed','replayed'].includes(mode) : mode === 'new';
  if (!validMode || !isAnalysisReceipt(result,request,mode==='resumed'?'resumed-isolated-session':'new-isolated-session') ||
      typeof result.output?.answer !== 'string' || !result.output.answer.trim()) throw new Error('没有收到这次提问的回答，请重试');
  const sources = readings.map(({ url, title, text, checkedAt }) => ({ url, title, excerpt: text.slice(0, 340), checkedAt }));
  return {
    answer: result.output.answer,
    ...(result.noteConversation && {conversationMode:result.noteConversation}),
    sourceIds: [Number.isSafeInteger(revision) ? noteId + '@' + revision : noteId, ...sources.map(source => source.url), ...memories.map(ref=>ref.source)],
    ...(sources.length > 0 && { sources }),
    ...(usePublicSources === true && !sources.length && { note: '未能读取公开链接，已按选中文字回答。' }),
  };
}
