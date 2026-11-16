import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfPreview({ bytes, name }: { bytes: Uint8Array; name: string }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null), [page, setPage] = useState(1), [error, setError] = useState(''), [rendering, setRendering] = useState(true), [pageText, setPageText] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true; setError(''); setPage(1); setDocument(null);
    const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).href;
    const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true, enableXfa: false, cMapUrl: assets + 'cmaps/', cMapPacked: true, standardFontDataUrl: assets + 'standard_fonts/', wasmUrl: assets + 'wasm/' });
    task.promise.then(value => { if (active) setDocument(value); }).catch(reason => { if (active) setError(reason?.name === 'PasswordException' ? '此 PDF 已加密，请在本地 PDF 阅读器中打开。' : 'PDF 暂时无法读取，请查看原文件。'); });
    return () => { active = false; void task.destroy(); };
  }, [bytes]);
  useEffect(() => {
    if (!document) return;
    let active = true, render: RenderTask | undefined; setRendering(true); setPageText('');
    document.getPage(page).then(value => {
      if (!active || !canvas.current) return;
      void value.getTextContent().then(content => { if (active) setPageText(content.items.map(item => 'str' in item ? item.str : '').join(' ')); }).catch(() => {});
      const original = value.getViewport({ scale: 1 });
      const viewport = value.getViewport({ scale: Math.min(1.5, 1200 / original.width, 1800 / original.height) });
      canvas.current.width = viewport.width; canvas.current.height = viewport.height;
      render = value.render({ canvas: canvas.current, viewport, annotationMode: 0 });
      return render.promise;
    }).then(() => { if (active) setRendering(false); }).catch(reason => { if (active && reason?.name !== 'RenderingCancelledException') { setError('此页无法预览，请查看原文件。'); setRendering(false); } });
    return () => { active = false; render?.cancel(); };
  }, [document, page]);
  return <div className="qd-attachment-pdf">{error ? <p role="alert">{error}</p> : <><div className="qd-attachment-pdf-controls"><button type="button" disabled={!document || page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><span role="status">{document ? `${page} / ${document.numPages} 页` : '正在读取 PDF…'}</span><button type="button" disabled={!document || page >= document.numPages} onClick={() => setPage(value => value + 1)}>下一页</button></div><canvas ref={canvas} aria-label={`${name}，第 ${page} 页`} aria-busy={rendering} role="img" />{pageText && <details className="qd-attachment-pdf-text"><summary>读取页面文字</summary><p>{pageText}</p></details>}</>}</div>;
}
