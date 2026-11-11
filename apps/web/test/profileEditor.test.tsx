// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PublicProfileDoc } from '@asl/platform';

vi.mock('../src/firebase', () => ({
  api: vi.fn(),
  db: {},
  errorOf: (error: unknown) => ({ code: 'unknown', message: String(error) }),
  storage: {},
}));

import { ProfileEditor } from '../src/profile/PublicProfilePage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('public profile editor', () => {
  it('includes a profile-picture upload without submitting the profile form', () => {
    const profile = {
      uid: 'player-1',
      nickname: 'PlayerOne',
      nicknameNormalized: 'playerone',
      photoURL: null,
      description: '',
      location: '',
      language: 'en',
      xp: 0,
      elo: 1200,
      wins: 0,
      losses: 0,
      draws: 0,
      medals: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as PublicProfileDoc;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    act(() => root!.render(createElement(ProfileEditor, { profile, onClose: () => {} })));

    const upload = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Upload a picture');
    expect(upload).toBeInstanceOf(HTMLButtonElement);
    expect(upload?.getAttribute('type')).toBe('button');
    expect(host.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('image/png,image/jpeg,image/webp');
  });
});
