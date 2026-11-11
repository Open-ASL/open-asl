import { defineProject } from 'vitest/config';

// Scenario tests build and play whole scenarios; under machine load some pass 5s.
export default defineProject({ test: { name: 'content', include: ['test/**/*.test.ts'], testTimeout: 20_000 } });
