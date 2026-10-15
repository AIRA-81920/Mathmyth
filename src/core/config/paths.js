// Platform-independent persistence names. The SQLite file stays in IndexedDB;
// browser, Capacitor and any later desktop shell use the same domain modules.
export const DATABASE_STORAGE_NAME = 'mathmyth-local';
export const DATABASE_STORAGE_VERSION = 1;
export const DATABASE_OBJECT_STORE = 'sqlite-files';
export const DATABASE_FILE_KEY = 'learning.sqlite';
export const DATABASE_EXPORT_NAME = 'mathmyth.sqlite';
export const desktopDataPaths = () => globalThis.mathmythDesktop?.paths ?? null;
