import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

// Pure helpers only (lib/views.ts): nothing here touches firebase-admin or the emulators. The workspace packages
// are reached the way the bundle reaches them (tsconfig `paths`), since functions/ declares no workspace deps.
export default defineProject({
  resolve: { alias: [{ find: /^@asl\/(.*)$/, replacement: fileURLToPath(new URL('../packages/$1/src/index.ts', import.meta.url)) }] },
  test: { name: 'functions', include: ['test/**/*.test.ts'], testTimeout: 60_000 },
});
