// The chat store registers when loaded. Startup and memory-only sessions can
// flush safely without importing a second store or creating a database worker.
let flush = async () => true;
export function registerPracticeDraftFlush(callback) { flush = callback; }
export function flushPracticeDrafts() { return flush(); }
