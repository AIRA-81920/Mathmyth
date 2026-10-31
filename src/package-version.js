// 版本号只有一处来源：package.json。打包脚本 scripts/version.mjs 会同时写这里的上游
// （package.json）、Android 的 versionName/versionCode，三者永远一致。
import { version } from '../package.json';

export const APP_VERSION = version;
