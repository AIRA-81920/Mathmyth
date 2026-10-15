// One short-lived worker per save. Lossless PNG and original pixel dimensions
// are deliberate: a faster JPEG conversion could blur small formulas.
self.onmessage = async ({ data: { bitmap } }) => {
  let canvas;
  try {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas_unavailable');
    context.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    self.postMessage({ blob });
  } catch {
    self.postMessage({ error: 'crop_worker_encode_failed' });
  } finally {
    bitmap.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
};
