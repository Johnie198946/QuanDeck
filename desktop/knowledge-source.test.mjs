import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleNoteLinks, isPublicAddress, publicKnowledgeUrl, readableKnowledgeText, readPublicKnowledgeSource } from './app/knowledge-source.mjs';

test('personal source reader accepts only public HTTPS addresses and discards query tokens', () => {
  for (const candidate of [
    'http://example.com/article', 'https://localhost/doc', 'https://server.internal/article',
    'https://127.9.0.1/', 'https://2130706433/', 'https://[::ffff:127.0.0.1]/', 'https://example.com:8443/',
    'https://username:password@example.com/', 'https://example.com/?token=secret'
  ]) assert.throws(() => publicKnowledgeUrl(candidate), candidate);
  assert.equal(publicKnowledgeUrl('https://example.com/article#heading').href, 'https://example.com/article');
  for (const address of ['127.1.1.1','169.254.169.254','10.0.0.4','100.127.255.254','172.30.0.5','192.168.1.1','224.0.0.1','203.0.113.2','::1','::ffff:127.0.0.1','fc00::90','fe80::1','2002:7f00:1::','2001:db8::1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700::1111'), true);
  assert.deepEqual(eligibleNoteLinks('看这篇 https://example.com/a。https://example.com/a#b；https://example.com/b。https://example.com/c'),
    ['https://example.com/a', 'https://example.com/b']);
});

test('personal source excerpts retain readable citations and strip active markup', () => {
  const payload = '<html><head><title>山野 &amp; 温泉</title><script>malicious words</script></head>' +
    '<body><nav>menu hidden</nav><article><h1>公开旅行指南</h1><p>这篇正文讲述可核对的温泉交通与出行路线。</p>' +
    '<svg><text>evil</text></svg><iframe src="https://example.com"></iframe></article></body></html>';
  const source = readableKnowledgeText('text/html;charset=utf-8', payload);
  assert.equal(source.title, '山野 & 温泉');
  assert.match(source.text, /公开旅行指南\n这篇正文/);
  assert.doesNotMatch(source.text, /malicious words|menu|svg|iframe|evil|example\.com/);
});

test('each redirect checks the resolved destination before connecting', async () => {
  const hosts = [];
  const reads = [];
  const addressesFor = async hostname => {
    hosts.push(hostname);
    return hostname === 'target.example.com'
      ? [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.8', family: 4 }]
      : [{ address: '8.8.8.8', family: 4 }];
  };
  const readPage = async (url, addresses) => {
    reads.push(url.hostname);
    assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]);
    return { redirect: 'https://target.example.com/article' };
  };
  await assert.rejects(readPublicKnowledgeSource('https://first.example.com/', { addressesFor, readPage }), /不是公开地址/);
  assert.deepEqual(hosts, ['first.example.com', 'target.example.com']);
  assert.deepEqual(reads, ['first.example.com']);
  await assert.rejects(readPublicKnowledgeSource('https://first.example.com/', {
    addressesFor, readPage: async () => ({ redirect: 'http://address.example.com/' }),
  }), /公开 HTTPS/);
});
