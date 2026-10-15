import { Capacitor, registerPlugin } from '@capacitor/core';
const plugin = registerPlugin('MathmythStream');
export const canNativeStream = () => Capacitor.isPluginAvailable('MathmythStream') || Boolean(globalThis.mathmythDesktop);

export function nativeStreamRequest(url, { headers, body, signal, connectTimeout, readTimeout }) {
  const driver = globalThis.mathmythDesktop ?? plugin;
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let listener, streamController, started = false, finished = false;
    const encoder = new TextEncoder();
    const failure = (code) => Object.assign(new Error(code), { name: code === 'aborted' ? 'AbortError' : 'Error' });
    function cleanup() {
      signal?.removeEventListener('abort', abort);
      listener?.remove().catch(() => {});
    }
    function finish(error, cancel = false) {
      if (finished) return;
      finished = true;
      if (cancel) driver.cancel({ id }).catch(() => {});
      cleanup();
      if (!started) reject(error ?? failure('network'));
      else if (!cancel && error) streamController.error(error);
      else if (!cancel) streamController.close();
    }
    const abort = () => finish(signal?.reason ?? failure('aborted'), true);
    signal?.addEventListener('abort', abort, { once: true });
    driver.addListener('httpStream', (event) => {
      if (event.id !== id || finished) return;
      if (event.type === 'start') {
        started = true;
        const stream = new ReadableStream({ start(controller) { streamController = controller; }, cancel() { finish(undefined, true); } });
        resolve(new Response(stream, { status: event.status, headers: { 'Content-Type': event.contentType ?? '' } }));
      } else if (event.type === 'chunk' && started) streamController.enqueue(encoder.encode(event.text));
      else if (event.type === 'end') finish();
      else if (event.type === 'error') finish(failure(event.code));
    }).then(async (handle) => {
      listener = handle;
      if (finished || signal?.aborted) { abort(); await handle.remove(); return; }
      try { await driver.start({ id, url, headers, body, connectTimeout, readTimeout }); }
      catch { finish(failure('network'), true); }
    }, () => finish(failure('network')));
    if (signal?.aborted) abort();
  });
}
