import { createSkeleton } from './index.js';

const loaders = import.meta.glob('../../assets/skeleton/*.json', { import: 'default' });
let cached;
export function loadSkeleton() {
  if (!cached) cached = Promise.all(Object.entries(loaders).map(async ([path, read]) => [path, await read()]))
    .then((entries) => createSkeleton(Object.fromEntries(entries)))
    .catch((error) => { cached = undefined; throw error; });
  return cached;
}
