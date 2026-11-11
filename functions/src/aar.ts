import { logger } from 'firebase-functions/v2';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { COL, type AarDoc, type AarPlayer, type MatchDoc } from '@asl/platform';
import { db } from './lib/app';
import { aarDue, aarElo, aarPlayers, composeAar } from './lib/aarDoc';
import { SITE, cardPng, esc, shareText } from './aarCard';

export { aarPlayers } from './lib/aarDoc';

/*
 * After action reports. `writeAarOnComplete` fires when a match document turns complete: it replays the recording and
 * stores the report whole in aars/{matchId}, in a function of its own with a long timeout and a full CPU. The scoring
 * callables used to write it inline after their transaction, and a 675-action game took the whole 60 s request limit
 * (Cloud Run 504): the result was saved but the report never appeared. A failure here never
 * fails the match; it is logged and the report is simply absent (an admin script can backfill it).
 * `aarPage` serves the share link: per-report Open Graph tags for crawlers (then the SPA), and the 1200×630 card image
 * the tags point at.
 */

/** A match has just completed in public: build and store its report (idempotent: a report already stored stays). */
export const writeAarOnComplete = onDocumentUpdated({ document: `${COL.matches}/{matchId}`, timeoutSeconds: 540, memory: '1GiB' }, async (event) => {
  const before = event.data?.before.data() as MatchDoc | undefined;
  const after = event.data?.after.data() as MatchDoc | undefined;
  if (!aarDue(before, after)) return;
  const matchId = event.params.matchId;
  if ((await db.collection(COL.aars).doc(matchId).get()).exists) return;
  await writeAar(matchId, aarPlayers(after!, after!.result ?? null, await aarElo(db, after!)));
});

/** Build and store the report of a completed match. Never throws. */
export async function writeAar(matchId: string, players: Record<string, AarPlayer>): Promise<void> {
  try {
    const doc = await composeAar(db, matchId, players);
    if (doc) await db.collection(COL.aars).doc(matchId).set(doc);
  } catch (e) {
    logger.error(`After action report for ${matchId} not written`, e);
  }
}

/**
 * /aar/{matchId}: social crawlers get the report's own metadata, browsers hydrate the SPA at the
 * same URL. /aar/{matchId}/card.png: the share image, rendered from the stored report and cached.
 */
export const aarPage = onRequest({ memory: '512MiB' }, async (req, res) => {
  const parts = req.path.split('/').filter(Boolean);
  const id = parts[0] === 'aar' ? (parts[1] ?? '') : (parts[0] ?? '');
  const wantsCard = parts.at(-1) === 'card.png';
  const doc = /^[A-Za-z0-9_-]{1,64}$/.test(id) ? ((await db.collection(COL.aars).doc(id).get()).data() as AarDoc | undefined) : undefined;
  if (wantsCard) {
    if (!doc) {
      res.set('Cache-Control', 'public, max-age=60').status(404).send('No such report');
      return;
    }
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=604800').type('png').send(cardPng(doc));
    return;
  }
  const { title, description } = doc ? shareText(doc) : { title: 'After action report · Open ASL', description: 'An Open ASL after action report.' };
  const canonical = `${SITE}/aar/${encodeURIComponent(id)}`;
  const image = doc ? `${canonical}/card.png` : `${SITE}/icons/og.png`;
  res.set('Cache-Control', doc ? 'public, max-age=300, s-maxage=86400' : 'public, max-age=60');
  res.status(doc ? 200 : 404).type('html').send(`<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta property="og:type" content="article"><meta property="og:site_name" content="Open ASL"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:image" content="${esc(image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:url" content="${esc(canonical)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(image)}"><link rel="canonical" href="${esc(canonical)}"></head><body><p>Loading ${esc(title)}…</p><script>fetch('/index.html').then(r=>r.text()).then(html=>{document.open();document.write(html);document.close()})</script></body></html>`);
});
