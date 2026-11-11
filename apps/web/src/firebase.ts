import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, connectAuthEmulator, getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import { getDatabase } from 'firebase/database';
import type { CallableName, Callables } from '@asl/platform';
import { connectSameOriginStorageEmulator } from './storageEmulator';

/**
 * Firebase client. With no VITE_FIREBASE_* config the app targets the local emulator suite
 * under the "demo-asl-web" project, which needs no real Firebase project or credentials.
 * Set VITE_USE_EMULATORS=false (and the real config) to point a dev build at production.
 *
 * In emulator mode every emulator is reached through the Vite dev server's own origin
 * (see the proxy in vite.config.ts), so it also works over HTTPS, e.g. behind an HTTPS reverse proxy.
 */
const env = import.meta.env;
const projectId = env.VITE_FIREBASE_PROJECT_ID ?? 'demo-asl-web';
export const usingEmulators = env.VITE_USE_EMULATORS !== 'false' && (env.DEV || projectId.startsWith('demo-'));
const region = 'us-central1';

export const app = initializeApp({
  projectId,
  apiKey: env.VITE_FIREBASE_API_KEY ?? 'demo-key',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? `${projectId}.appspot.com`,
  appId: env.VITE_FIREBASE_APP_ID,
  // The emulator is reached through the dev origin like everything else (ws:// or wss:// as the page is), so presence works behind an HTTPS reverse proxy too.
  // The namespace must be the one the emulator is configured for (the default instance name), or it silently opens an empty one.
  // A ws(s):// scheme makes the SDK websocket-only: its long-polling fallback rebuilds URLs from the host the emulator reports
  // in its handshake (127.0.0.1:9000), which nothing but this machine can reach, so a browser that once fell back would never recover.
  databaseURL: usingEmulators ? `${location.origin.replace(/^http/, 'ws')}/?ns=${projectId}-default-rtdb` : env.VITE_FIREBASE_DATABASE_URL ?? `https://${projectId}-default-rtdb.firebaseio.com`,
});

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = usingEmulators
  ? initializeFirestore(app, { host: location.host, ssl: location.protocol === 'https:', experimentalForceLongPolling: true })
  : getFirestore(app);
export const functions = usingEmulators
  ? getFunctions(app, `${location.origin}/__fn/${projectId}/${region}`)
  : getFunctions(app, region);
export const storage = getStorage(app);
export const realtime = getDatabase(app);

if (usingEmulators) {
  connectAuthEmulator(auth, location.origin, { disableWarnings: true });
  connectSameOriginStorageEmulator(storage, location);
}

/** Call a Cloud Function by name with the request/response types from @asl/platform. */
export async function api<N extends CallableName>(name: N, data: Callables[N]['req']): Promise<Callables[N]['res']> {
  const fn = httpsCallable<Callables[N]['req'], Callables[N]['res']>(functions, name);
  const { data: res } = await fn(data);
  return res;
}

/** The message and short code of a failed call, whatever threw it. */
export function errorOf(e: unknown): { code: string; message: string } {
  const err = e as { code?: string; message?: string; details?: { code?: string } };
  const code = err?.details?.code ?? (err?.code ?? 'unknown').replace(/^(functions|auth)\//, '');
  return { code, message: err?.message ?? String(e) };
}
