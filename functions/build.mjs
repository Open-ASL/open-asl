// Bundles the functions with the workspace engine/rules/content/platform packages inlined. They are
// resolved through the `paths` in tsconfig.json rather than declared as dependencies, because Cloud
// Build runs plain npm on the uploaded package.json and cannot resolve `workspace:*` specifiers.
import { build, context } from 'esbuild';

const options = {
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // The share-card renderer is a native module: installed on deploy, never bundled.
  external: ['firebase-admin', 'firebase-functions', '@resvg/resvg-js'],
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  await (await context(options)).watch();
} else {
  await build(options);
}
