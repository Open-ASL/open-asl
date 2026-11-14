import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The dev server fronts the Firebase emulators on its own origin, so the app works the same
// on localhost and behind an HTTPS reverse proxy without exposing emulator ports.
const emulator = (port: number, rewrite?: (p: string) => string) => ({
  target: `http://127.0.0.1:${port}`,
  changeOrigin: true,
  ws: true,
  ...(rewrite ? { rewrite } : {}),
});

// Local-only assets (scenario card photographs, audio overrides; see README) live in
// assets-local/ at the repo root, which is not in git. In development these directories of it
// are served at the same paths the app uses in production, ahead of the committed art in art/.
// Nothing else in assets-local/ (the rulebook, the video kit) is reachable.
const LOCAL_ASSETS = fileURLToPath(new URL('../../assets-local', import.meta.url));
const LOCAL_DIRS = ['scenarios', 'audio', 'boards', 'counters', 'markers'];
const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.webm': 'audio/webm',
};
const localAssets = (): Plugin => ({
  name: 'local-assets',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
      const file = normalize(join(LOCAL_ASSETS, url));
      const inside = LOCAL_DIRS.some((d) => file.startsWith(join(LOCAL_ASSETS, d) + sep));
      if (!inside || !existsSync(file) || !statSync(file).isFile()) return next();
      res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
      createReadStream(file).pipe(res);
    });
  },
});

// Static pages shipped in art/ (e.g. art/sheets/ge/index.html): Firebase Hosting serves a folder's
// index.html for /sheets/ge and /sheets/ge/; the dev server would hand those to the app's router.
const ART = fileURLToPath(new URL('./art', import.meta.url));
const artPages = (): Plugin => ({
  name: 'art-pages',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
      if (extname(url)) return next();
      const file = normalize(join(ART, url, 'index.html'));
      if (!file.startsWith(ART + sep) || !existsSync(file)) return next();
      if (!url.endsWith('/')) {
        // As Firebase does: the trailing slash keeps the page's relative links right.
        res.statusCode = 301;
        res.setHeader('Location', url + '/');
        return res.end();
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      createReadStream(file).pipe(res);
    });
  },
});

// Which computer opponent this build ships, if any: the commit, plus a hash of any uncommitted change
// to its source. Recorded on the computer's moves.
function botVersion(): string {
  try {
    const cwd = join(fileURLToPath(new URL('../../packages', import.meta.url)), 'ai');
    const git = (c: string) => execSync(`git ${c}`, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
    const commit = git('rev-parse --short HEAD').trim();
    const diff = git('diff HEAD -- src') + git('ls-files --others --exclude-standard -- src');
    return diff ? `${commit}+${createHash('sha1').update(diff).digest('hex').slice(0, 7)}` : commit;
  } catch {
    return 'unknown';
  }
}

// The commit this build was made from, marked when tracked code differs from it: the code a game was played with.
function appVersion(): string {
  try {
    const cwd = fileURLToPath(new URL('../..', import.meta.url));
    const commit = execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain --untracked-files=no -- apps packages', { cwd, encoding: 'utf8' }).trim();
    return dirty ? `${commit}+dirty` : commit;
  } catch {
    return 'unknown';
  }
}

// Dev-server settings from apps/web/.env*.local (see .env.example).
const DEV_ENV = loadEnv('development', fileURLToPath(new URL('.', import.meta.url)), 'VITE_DEV_');

export default defineConfig({
  define: { __BOT_VERSION__: JSON.stringify(botVersion()), __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [react(), localAssets(), artPages()],
  // VASL-derived boards, counters and markers (LGPL-2.1, see NOTICE.md). Copied into dist/ by the build.
  publicDir: 'art',
  server: {
    port: 5173,
    host: '127.0.0.1',
    // Extra host names the dev server answers to, e.g. behind a reverse proxy: VITE_DEV_ALLOWED_HOSTS=.example.net,dev.example.org
    allowedHosts: ['localhost', ...(DEV_ENV['VITE_DEV_ALLOWED_HOSTS'] ?? '').split(',').map((h) => h.trim()).filter(Boolean)],
    proxy: {
      // Auth emulator
      '/identitytoolkit.googleapis.com': emulator(9099),
      '/securetoken.googleapis.com': emulator(9099),
      '/emulator/': emulator(9099),
      // Firestore emulator (WebChannel + REST)
      '/google.firestore.v1.Firestore': emulator(8080),
      '/v1/projects': emulator(8080),
      // Functions emulator, addressed as a custom domain
      '/__fn': emulator(5001, (p) => p.replace(/^\/__fn/, '')),
      // Storage emulator
      '/v0/b': emulator(9199),
      // Realtime Database emulator (websocket and long-polling transports; the client sends ?ns=).
      // The Host header is kept: the emulator echoes it in its handshake and the SDK reconnects to
      // whatever host it is told, so rewriting it would send later connections straight to 9000.
      '/.ws': { ...emulator(9000), changeOrigin: false },
      '/.lp': { ...emulator(9000), changeOrigin: false },
    },
  },
  build: { target: 'es2022' },
});
