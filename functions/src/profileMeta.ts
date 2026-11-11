import { onRequest } from 'firebase-functions/v2/https';
import { COL, type NicknameDoc, type PublicProfileDoc } from '@asl/platform';
import { db } from './lib/app';
import { DEFAULT_APP_ORIGIN } from './lib/email';

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Social crawlers receive profile-specific metadata; browsers hydrate the normal SPA at the same URL. */
export const profilePage = onRequest(async (req, res) => {
  const nickname = decodeURIComponent(req.path.split('/').filter(Boolean).at(-1) ?? '').toLowerCase();
  const alias = nickname ? (await db.collection(COL.nicknames).doc(nickname).get()).data() as NicknameDoc | undefined : undefined;
  const profile = alias ? (await db.collection(COL.publicProfiles).doc(alias.uid).get()).data() as PublicProfileDoc | undefined : undefined;
  const title = profile ? `${profile.nickname} · Open ASL` : 'Player profile · Open ASL';
  const description = profile?.description || (profile ? `${profile.nickname}'s ranked Advanced Squad Leader service record.` : 'Open ASL player service record.');
  const image = profile?.photoURL ?? `${DEFAULT_APP_ORIGIN}/icons/og.png`;
  const canonical = `${DEFAULT_APP_ORIGIN}/profile/${alias?.current ?? nickname}`;
  res.set('Cache-Control', 'public, max-age=300, s-maxage=900');
  res.status(profile ? 200 : 404).type('html').send(`<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta property="og:type" content="profile"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:image" content="${esc(image)}"><meta property="og:url" content="${esc(canonical)}"><meta name="twitter:card" content="summary_large_image"><link rel="canonical" href="${esc(canonical)}"></head><body><p>Loading ${esc(title)}…</p><script>fetch('/index.html').then(r=>r.text()).then(html=>{document.open();document.write(html);document.close()})</script></body></html>`);
});
