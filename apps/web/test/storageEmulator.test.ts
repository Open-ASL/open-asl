import { describe, expect, it } from 'vitest';
import type { FirebaseStorage } from 'firebase/storage';
import { connectSameOriginStorageEmulator } from '../src/storageEmulator';

type ConnectedStorage = FirebaseStorage & { host: string; _isUsingEmulator: boolean; _protocol: string };

describe('local Storage connection', () => {
  it('uses the proxied HTTPS origin without downgrading to mixed content', () => {
    const storage = {} as ConnectedStorage;

    connectSameOriginStorageEmulator(storage, { hostname: 'asl.example.test', port: '', protocol: 'https:' });

    expect(storage.host).toBe('asl.example.test:443');
    expect(storage._isUsingEmulator).toBe(true);
    expect(storage._protocol).toBe('https');
  });

  it('keeps an explicit local development port', () => {
    const storage = {} as ConnectedStorage;

    connectSameOriginStorageEmulator(storage, { hostname: 'localhost', port: '5173', protocol: 'http:' });

    expect(storage.host).toBe('localhost:5173');
    expect(storage._protocol).toBe('http');
  });
});
