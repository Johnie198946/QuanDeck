import { lookup as resolveDns } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';

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

export function eligibleNoteLinks(body) {
  const urls = new Set();
  for (const match of body.matchAll(/https:\/\/[^\s<>()\[\]"'，。；！、]+/gu)) {
    try { urls.add(publicKnowledgeUrl(match[0].replace(/[.,;!?]+$/, '')).href); } catch { /* Keep untouched as note text. */ }
  }
  return [...urls].slice(0, 2);
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
