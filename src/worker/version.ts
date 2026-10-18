declare const __ASSET_VERSION__: string | undefined;

/** Cache-busting value for /assets URLs, set by the build. */
export const ASSET_VERSION: string = typeof __ASSET_VERSION__ === 'string' ? __ASSET_VERSION__ : 'dev';

declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
