import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { COMPUTER_NAME, type AarDoc } from '@asl/platform';
import { DEFAULT_APP_ORIGIN } from './lib/email';

/*
 * The share card and share texts of an after action report, drawn from the stored document
 * alone. Kept free of Firebase so it can be rendered and looked at outside the functions runtime.
 */

export const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const SITE = DEFAULT_APP_ORIGIN.replace(/\/$/, '');
const SITE_HOST = new URL(SITE).host.toUpperCase();

/** Counter stock colours of the nationalities, as the app's side tokens. */
const SIDE_COLOR: Record<string, string> = { ge: '#86acd0', ru: '#d0a24e', am: '#9cbb4e', br: '#d9c38a', al: '#8fb36a', it: '#aab4ba' };

function star(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (-90 + i * 36) * (Math.PI / 180);
    const rr = i % 2 === 0 ? r : r * 0.42;
    pts.push(`${(Math.cos(a) * rr).toFixed(2)},${(Math.sin(a) * rr).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

/** National emblem centred on the origin, about 40 units across (the same drawings as the app's turn chit). */
function emblem(nationality: string): string {
  switch (nationality) {
    case 'ge':
      return '<path d="M-6,-20 H6 V-6 H20 V6 H6 V20 H-6 V6 H-20 V-6 H-6 Z" fill="#fff" stroke="#fff" stroke-width="5" stroke-linejoin="miter"/><path d="M-6,-20 H6 V-6 H20 V6 H6 V20 H-6 V6 H-20 V-6 H-6 Z" fill="#111"/>';
    case 'am':
      return `<path d="${star(21)}" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/>`;
    case 'ru':
      return `<path d="${star(21)}" fill="#d22d26" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/>`;
    case 'br':
      return '<circle r="21" fill="#2a4b9b" stroke="#111" stroke-width="1.5"/><circle r="14" fill="#fff"/><circle r="7" fill="#d22d26"/>';
    case 'it':
      return [-12, 0, 12].map((x) => `<g fill="#4a3a48" stroke="#111" stroke-width="1"><rect x="${x - 2.5}" y="-20" width="5" height="40"/><path d="M${x + 2.5},4 l6,-4 l-1,9 l-5,1 Z"/></g>`).join('');
    default:
      return `<text y="8" text-anchor="middle" font-family="Black Ops One" font-size="26" fill="#111">${esc(nationality.toUpperCase())}</text>`;
  }
}

const kindLabel = (doc: AarDoc) => (doc.mode === 'hotseat' ? 'HOTSEAT' : doc.sides.some((s) => s.player.computer) ? `VS ${COMPUTER_NAME.toUpperCase()}` : doc.competition === 'ranked' ? 'RANKED' : 'FRIENDLY');
const cvpOf = (doc: AarDoc, side: string) => doc.casualties.filter((c) => c.side === side).reduce((a, c) => a + c.cvp, 0);
const eloLine = (doc: AarDoc, side: string) => {
  const p = doc.sides.find((s) => s.side === side)!.player;
  const d = p.eloDelta;
  return d === undefined || doc.competition !== 'ranked' ? '' : ` · ${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)} ELO`;
};

/** The 1200×630 share card as SVG. */
export function cardSvg(doc: AarDoc): string {
  const [a, b] = doc.sides;
  if (!a || !b) throw new Error('A report needs two sides');
  const winner = doc.result.winner ? doc.sides.find((s) => s.side === doc.result.winner) ?? null : null;
  const colour = winner ? (SIDE_COLOR[winner.nationality] ?? '#c9a24a') : '#9ea58b';
  const luck = doc.luck;
  const series = [a, b].map((s) => luck.sides[s.side] ?? [0]);
  const all = series.flat();
  const lo = Math.min(-1, ...all);
  const hi = Math.max(1, ...all);
  const n = Math.max(2, luck.labels.length);
  const sx = (i: number) => 700 + (i / (n - 1)) * 440;
  const sy = (v: number) => 290 + (1 - (v - lo) / (hi - lo)) * 180;
  const line = (vals: number[]) => vals.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  const endLabel = (vals: number[], idx: number) => {
    const v = vals.at(-1) ?? 0;
    return `<text x="1140" y="${(sy(v) + (idx === 0 ? -10 : 26)).toFixed(1)}" text-anchor="end" font-family="Oswald" font-weight="600" font-size="18" fill="#ece6d2">${v > 0 ? '+' : ''}${v}</text>`;
  };
  const player = (s: typeof a, x: number) => `
    <g transform="translate(${x + 24},24)"><circle r="24" fill="${SIDE_COLOR[s.nationality] ?? '#c9a24a'}" fill-opacity=".22" stroke="${SIDE_COLOR[s.nationality] ?? '#c9a24a'}"/>${emblem(s.nationality)}</g>
    <text x="${x + 62}" y="20" font-family="Oswald" font-weight="600" font-size="24" fill="#ece6d2">${esc(s.player.nickname)}</text>
    <text x="${x + 62}" y="44" font-family="Oswald" font-weight="600" font-size="16" letter-spacing="2" fill="${doc.result.winner === s.side ? '#7fc45a' : doc.result.winner ? '#ff5f55' : '#9ea58b'}">${esc(s.name.toUpperCase())}${esc(eloLine(doc, s.side))}</text>`;
  const title = `${doc.scenario.number} ${doc.scenario.title}`.toUpperCase();
  // The title keeps to the left column (about 600px): Black Ops One runs some 36px per glyph at 60px.
  const titleSize = title.length > 24 ? 36 : title.length > 14 ? 48 : 60;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b201b"/><stop offset="1" stop-color="#0b0e0b"/></linearGradient>
    <radialGradient id="glow" cx="0.12" cy="0" r="0.8"><stop offset="0" stop-color="#c9a24a" stop-opacity=".28"/><stop offset="1" stop-color="#c9a24a" stop-opacity="0"/></radialGradient>
    <linearGradient id="em" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0cf72"/><stop offset="1" stop-color="#a8842e"/></linearGradient>
    <pattern id="hex" width="56" height="97" patternUnits="userSpaceOnUse"><path d="M28 0 56 16v32L28 64 0 48V16zM28 64v33M56 48l-28 16M0 48l28 16" fill="none" stroke="#fff" stroke-opacity=".06" stroke-width="1.2"/></pattern>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/><rect width="1200" height="630" fill="url(#hex)"/><rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="0" y="0" width="1200" height="8" fill="#c9a24a"/>
  <text x="64" y="92" font-family="Oswald" font-weight="600" font-size="22" letter-spacing="5" fill="#c9a24a">AFTER ACTION REPORT · ${esc(kindLabel(doc))}</text>
  <text x="64" y="160" font-family="Black Ops One" font-size="${titleSize}" fill="#ece6d2">${esc(title)}</text>
  <text x="64" y="196" font-family="Barlow" font-size="22" fill="#9ea58b">${esc(doc.scenario.place)} · ${esc(doc.scenario.date)}</text>
  <rect x="64" y="236" width="8" height="150" fill="${colour}"/>
  <text x="92" y="292" font-family="Oswald" font-weight="600" font-size="22" letter-spacing="8" fill="#c9a24a">${winner ? 'VICTORY' : 'DRAW'}</text>
  <text x="92" y="366" font-family="Black Ops One" font-size="78" fill="${colour}">${esc((winner ? winner.name : 'Stalemate').toUpperCase())}</text>
  <text x="64" y="430" font-family="Barlow" font-size="24" fill="#ece6d2">${esc(doc.result.how)}</text>
  <g transform="translate(64,486)">
    ${player(a, 0)}
    <text x="300" y="34" font-family="Black Ops One" font-size="26" fill="#55624a">VS</text>
    ${player(b, 362)}
  </g>
  <text x="700" y="92" font-family="Oswald" font-weight="600" font-size="16" letter-spacing="4" fill="#9ea58b">CASUALTIES · CVP</text>
  <text x="700" y="150" font-family="Black Ops One" font-size="44" fill="#ece6d2">${cvpOf(doc, a.side)} <tspan fill="#55624a" font-size="30">vs</tspan> ${cvpOf(doc, b.side)}</text>
  <text x="930" y="92" font-family="Oswald" font-weight="600" font-size="16" letter-spacing="4" fill="#9ea58b">AVERAGE DR</text>
  <text x="930" y="150" font-family="Black Ops One" font-size="40" fill="#ece6d2">${(doc.dice[a.side]?.avg ?? 0).toFixed(2)} <tspan fill="#55624a" font-size="30">vs</tspan> ${(doc.dice[b.side]?.avg ?? 0).toFixed(2)}</text>
  <text x="700" y="236" font-family="Oswald" font-weight="600" font-size="16" letter-spacing="4" fill="#9ea58b">LUCK SWING</text>
  <line x1="700" x2="1140" y1="${sy(0).toFixed(1)}" y2="${sy(0).toFixed(1)}" stroke="#55624a" stroke-width="1.5"/>
  <polyline points="${line(series[0]!)}" fill="none" stroke="${SIDE_COLOR[a.nationality] ?? '#c9a24a'}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
  <polyline points="${line(series[1]!)}" fill="none" stroke="${SIDE_COLOR[b.nationality] ?? '#c9a24a'}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
  ${endLabel(series[0]!, 0)}${endLabel(series[1]!, 1)}
  <g transform="translate(1040,520)">
    <path d="M44 3 82 25v46L44 93 6 71V25z" fill="#15190f" stroke="url(#em)" stroke-width="4" transform="scale(.9)"/>
    <text x="40" y="52" text-anchor="middle" font-family="Black Ops One" font-size="22" fill="url(#em)">OASL</text>
  </g>
  <text x="1010" y="580" text-anchor="end" font-family="Oswald" font-weight="600" font-size="18" letter-spacing="3" fill="#9ea58b">${esc(SITE_HOST)}</text>
</svg>`;
}

/** The bundled TrueType files the card is set in (functions/fonts, beside lib/). */
function fontFiles(): string[] {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fonts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.ttf')).map((f) => join(dir, f));
}

export function cardPng(doc: AarDoc): Buffer {
  const resvg = new Resvg(cardSvg(doc), { font: { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: 'Barlow' }, fitTo: { mode: 'width', value: 1200 } });
  return Buffer.from(resvg.render().asPng());
}

/** The texts the share tags carry. */
export function shareText(doc: AarDoc): { title: string; description: string } {
  const winner = doc.result.winner ? doc.sides.find((s) => s.side === doc.result.winner) : undefined;
  const loser = doc.sides.find((s) => s.side !== winner?.side);
  const title = `${winner ? `${winner.name} victory` : 'Draw'} · ${doc.scenario.number} ${doc.scenario.title} · after action report`;
  const named = (s: typeof winner) => (s ? `${s.player.nickname} (${s.name}${eloLine(doc, s.side).replace(' ELO', ' Elo')})` : '');
  const [a, b] = doc.sides;
  const outcome = winner && loser ? `${named(winner)} beat ${named(loser)}` : a && b ? `${named(a)} and ${named(b)} drew` : '';
  const stats = a && b ? ` Casualties ${cvpOf(doc, a.side)} CVP vs ${cvpOf(doc, b.side)}. Dice ${(doc.dice[a.side]?.avg ?? 0).toFixed(2)} vs ${(doc.dice[b.side]?.avg ?? 0).toFixed(2)}.` : '';
  return { title, description: `${outcome}: ${doc.result.how}.${stats}` };
}

