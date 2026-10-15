import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { readImageFile } from '../images/input.js';
GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdf(bytes, { signal, supportsImage, onProgress }) {
  const task = getDocument({ data: bytes, cMapUrl: `${import.meta.env.BASE_URL}pdf/cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${import.meta.env.BASE_URL}pdf/standard_fonts/`, wasmUrl: `${import.meta.env.BASE_URL}pdf/wasm/`, isEvalSupported: false });
  const stop = () => { task.destroy().catch(() => {}); };
  signal?.addEventListener('abort', stop, { once: true });
  const images = [], paragraphs = [];
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 20) throw new Error('PDF 超过 20 页，请只发送需要提问的页面。');
    for (let number = 1; number <= pdf.numPages; number++) {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
      onProgress(`正在读取 PDF：${number}/${pdf.numPages}`);
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
      paragraphs.push(`第 ${number} 页\n${text}`);
      if (!text && !supportsImage) throw new Error('这份 PDF 含扫描页，请开启图片能力后发送。');
      // Vision models also receive page images: PDF text extraction alone can
      // reorder fractions and drop diagrams, even when a text layer exists.
      if (supportsImage) {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 1600 / Math.max(base.width, base.height)) });
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const render = page.render({ canvasContext: canvas.getContext('2d'), viewport });
        const cancelRender = () => render.cancel(); signal?.addEventListener('abort', cancelRender, { once: true });
        try { await render.promise; } finally { signal?.removeEventListener('abort', cancelRender); }
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .88));
        images.push({ ...await readImageFile(new File([blob], `PDF-${number}.jpg`), { signal }), kind: 'image' });
        canvas.width = canvas.height = 0;
      }
      page.cleanup();
    }
    return { text: paragraphs.join('\n\n'), images };
  } catch (error) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    if (error.name === 'PasswordException') throw new Error('PDF 已加密，请先解除密码保护。');
    throw error;
  } finally { signal?.removeEventListener('abort', stop); await task.destroy(); }
}
