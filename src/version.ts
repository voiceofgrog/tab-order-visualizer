/** Replaced at build time (esbuild define) with the version from package.json. */
declare const __VERSION__: string;

export const VERSION: string = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';
