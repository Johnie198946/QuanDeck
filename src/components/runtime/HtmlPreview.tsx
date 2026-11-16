import { useMemo, useState } from 'react';
import { prepareHtmlPreview } from './sanitizeHtmlDocument';

export function HtmlPreview({ html, name }: { html: string; name: string }) {
  const [network, setNetwork] = useState(false), [map, setMap] = useState<number | null>(null);
  const document = useMemo(() => prepareHtmlPreview(html, network), [html, network]);
  return <div className="qd-html-reader">
    {(document.maps.length > 0 || document.hasExternalImages) && <div className="qd-html-tools">
      {document.maps.map((item, index) => <button type="button" key={item.url} aria-expanded={map === index} onClick={() => setMap(map === index ? null : index)}>{map === index ? '收起地图' : '展开地图'} · {item.title}</button>)}
      {document.hasExternalImages && <button type="button" onClick={() => setNetwork(!network)}>{network ? '隐藏网络图片' : '加载网络图片'}</button>}
    </div>}
    {map !== null && document.maps[map] && <iframe className="qd-html-map" title={document.maps[map].title} src={document.maps[map].url} sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />}
    <iframe className="qd-html-document" title={`图文预览：${name}`} srcDoc={document.html} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />
  </div>;
}
