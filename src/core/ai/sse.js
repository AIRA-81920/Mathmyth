import { AiRequestError, throwIfAborted, waitWithSignal } from './transport.js';

// Keep CR at the end of a chunk until the next chunk arrives, so a split CRLF
// is one line ending rather than an accidental blank line/event boundary.
export function createSseParser(onEvent) {
  let buffer = '';
  let data = [];
  let event = 'message';
  let stopped = false;

  function dispatch() {
    if (data.length && onEvent({ event, data: data.join('\n') }) === false) stopped = true;
    data = [];
    event = 'message';
  }

  function line(value) {
    if (!value) {
      dispatch();
      return;
    }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon === -1 ? value : value.slice(0, colon);
    let content = colon === -1 ? '' : value.slice(colon + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'data') data.push(content);
    else if (field === 'event') event = content;
  }

  function drain(final) {
    while (!stopped) {
      const index = buffer.search(/[\r\n]/);
      if (index === -1 || (!final && index === buffer.length - 1 && buffer[index] === '\r')) break;
      const length = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
      const value = buffer.slice(0, index);
      buffer = buffer.slice(index + length);
      line(value);
    }
    if (final && !stopped) {
      if (buffer) line(buffer);
      buffer = '';
      dispatch();
    }
  }

  return {
    push(chunk) { buffer += chunk; drain(false); },
    finish() { drain(true); },
    get stopped() { return stopped; },
  };
}

export async function readSseStream(body, { onEvent, signal } = {}) {
  if (!body?.getReader) throw new AiRequestError('服务商未返回可读取的回答，请重试。', 'invalid_response');
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  const parser = createSseParser(onEvent);
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    throwIfAborted(signal);
    while (!parser.stopped) {
      const { done, value } = await waitWithSignal(reader.read(), signal);
      throwIfAborted(signal);
      if (done) {
        parser.push(decoder.decode());
        parser.finish();
        break;
      }
      parser.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}
