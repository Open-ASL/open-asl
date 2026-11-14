/// <reference types="vite/client" />

/** The computer opponent's code version (commit, plus a hash of uncommitted bot changes), set by vite.config.ts. */
declare const __BOT_VERSION__: string;
/** The commit the app was built from (`+dirty` when tracked code had changed), set by vite.config.ts. */
declare const __APP_VERSION__: string;

declare module 'world-atlas/countries-110m.json' {
  const value: import('topojson-specification').Topology;
  export default value;
}

interface ImportMetaEnv {
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_USE_EMULATORS?: string;
  readonly VITE_ASSET_BASE?: string;
  readonly VITE_SITE_URL?: string;
  readonly VITE_SUPPORT_URL?: string;
  readonly VITE_SUPPORT_NAME?: string;
}
