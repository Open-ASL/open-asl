import { connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';

type BrowserEndpoint = Pick<Location, 'hostname' | 'port' | 'protocol'>;

/** Route the Storage emulator through the browser's same-origin development proxy. */
export function connectSameOriginStorageEmulator(storage: FirebaseStorage, page: BrowserEndpoint) {
  const port = Number(page.port || (page.protocol === 'https:' ? 443 : 80));
  connectStorageEmulator(storage, page.hostname, port);

  // connectStorageEmulator always selects HTTP. The same-origin proxy speaks the page's
  // protocol and forwards /v0/b to the emulator, so HTTPS development must retain HTTPS.
  (storage as FirebaseStorage & { _protocol: string })._protocol = page.protocol.replace(/:$/, '');
}
