import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'aar', include: ['test/**/*.test.ts'] } });
