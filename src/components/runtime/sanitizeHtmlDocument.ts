/** A passive document, rebuilt from an allowlist, inside a second sandbox boundary. */
export function prepareHtmlPreview(source: string, externalImages = false) {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const maps: { title: string; url: string }[] = [];
  let hasExternalImages = false;
  const tags = new Set('html head body title style main header footer nav section article aside div span p h1 h2 h3 h4 h5 h6 strong b em i u s small sub sup mark blockquote pre code br hr ul ol li dl dt dd figure figcaption img picture table caption colgroup col thead tbody tfoot tr th td details summary a input label'.split(' '));
  const attrs = new Set('class id title lang dir role aria-label aria-labelledby aria-describedby alt width height colspan rowspan scope open start reversed datetime'.split(' '));
  const https = (value: string) => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; } };
  for (const node of [...doc.querySelectorAll('*')]) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'iframe') {
      const url = https(node.getAttribute('src') ?? '');
      if (url && new URL(url).hostname === 'www.google.com' && /^\/maps\/embed(?:\/|$)/.test(new URL(url).pathname)) {
        const title = node.getAttribute('title') || 'Google Maps 路线地图';
        if (!maps.some(map => map.url === url)) maps.push({ title, url });
        const placeholder = doc.createElement('p'); placeholder.textContent = '路线地图 · 使用文档上方的「展开地图」查看'; node.replaceWith(placeholder);
      } else node.remove();
      continue;
    }
    if (!tags.has(tag)) { node.remove(); continue; }
    for (const attribute of [...node.attributes]) {
      const key = attribute.name.toLowerCase(), value = attribute.value;
      if (attrs.has(key)) continue;
      if (key === 'style') continue; // CSP forbids fetches and all script, including CSS url() fetches by default.
      if (tag === 'a' && key === 'href') {
        if (value.startsWith('#') || https(value)) continue;
      }
      if (tag === 'img' && key === 'src') {
        if (/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(value)) continue;
        if (https(value)) { hasExternalImages = true; if (externalImages) continue; }
      }
      node.removeAttribute(attribute.name);
    }
    if (tag === 'a' && node.hasAttribute('href') && !node.getAttribute('href')!.startsWith('#')) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
    if (tag === 'img') { node.setAttribute('loading', 'lazy'); node.setAttribute('referrerpolicy', 'no-referrer'); }
    if (tag === 'input') { node.setAttribute('type', 'checkbox'); node.setAttribute('aria-label', node.getAttribute('aria-label') || '清单事项'); }
  }
  const meta = doc.createElement('meta'); meta.httpEquiv = 'Content-Security-Policy';
  meta.content = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:${externalImages ? ' https:' : ''}; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  doc.head.prepend(meta);
  const viewport = doc.createElement('meta'); viewport.name = 'viewport'; viewport.content = 'width=device-width,initial-scale=1'; doc.head.append(viewport);
  const style = doc.createElement('style'); style.textContent = 'html{overflow-wrap:anywhere}img,video{max-width:100%}body{margin:0} @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}}'; doc.head.append(style);
  return { html: '<!doctype html>' + doc.documentElement.outerHTML, maps, hasExternalImages };
}
