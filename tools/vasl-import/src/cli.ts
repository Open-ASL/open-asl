/**
 * VASL import.
 *
 *   pnpm --filter @asl/vasl-import import -- --vmod <path|url> --board y=<path|url> --board z=<path|url>
 *
 * Writes art (counters, markers, boards as webp) to apps/web/art/ and derived data (counter
 * defs, asset manifest, board terrain + LOS rasters) to packages/content/src/generated/. Both
 * are committed and redistributed under the LGPL-2.1, like the VASL sources they come from
 * (see NOTICE.md).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { TO_HIT, toHitKey } from '@asl/content';
import { buildCounters, gunSlots, pieceInfos, pieceSlots } from './counters';
import { parseVehicleSvg, vehicleSlots } from './vehicles';
import type { MmcDef, VehicleDef } from '@asl/rules';
import { decodeLosData, deriveBoard } from './boards';
import { layeredMarker, rasterizeCounter, skCaveMarker, toWebp } from './raster';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const cacheDir = join(root, 'tools/vasl-import/cache');
const artDir = join(root, 'apps/web/art');
const genDir = join(root, 'packages/content/src/generated');

const DEFAULTS = {
  vmod: 'https://github.com/vasl-developers/vasl/releases/download/v6.7.3/vasl-6.7.3.vmod',
  board: (b: string) => `https://raw.githubusercontent.com/vasl-developers/vasl/develop/boards/bdFiles/bd${b}`,
};

/** SK1 + SK2 nationalities (British, Allied Minor, Italian), the Guns and the markers the client needs. */
const NATIONALITIES = ['ge', 'ru', 'am', 'br', 'al', 'it', 'ja'];
/**
 * Guns to import: every Gun of these nationalities with a row on the ASLSK To Hit Chart (`TO_HIT`),
 * where a mortar row (Area Target Type only) only fits a Mortar and a Gun row only a non-Mortar.
 */
const keepGun = (def: import('@asl/rules').GunDef) => {
  const row = TO_HIT[toHitKey(def)];
  if (!row) return false;
  return (row.fp.itt === undefined) === (def.type === 'MTR');
};
/** Light Mortar SW (SK4 4.5) with a row on the ASLSK To Hit Chart: German and Russian 50*, American 60*, British 51, Italian 45*, Allied Minor 46*. */
const MORTARS = ['geMTR', 'ruMTR', 'amMTR', 'brMTR', 'itMTR', 'alMTR46', 'jaMTR'];
/** Light Anti-Tank Weapons (SK4 4.4) with their own To Hit Table on the counter back: the American Bazookas and the German Panzerschreck. */
const LATW = ['amBAZ43', 'amBAZ44', 'amBAZ45', 'gePSK', 'brPIAT', 'gePF'];
/** Vehicles to import (SK3), by VASL piece name; add a card's vehicles here as scenarios are encoded. */
/** Boards whose committed art is the asl-players.net high-resolution redraw, not VASL's: the import leaves it alone. */
const REDRAWN_BOARDS = new Set(['m', 'n', 'o', 't', 'u', 'v', 'w', 'x', 'y', 'z']);

const VEHICLES = ['T-34 M43', 'T-34 M41', 'PzKw VIE', 'PzKw IVF2', 'PzKw IVH', 'PSW 234/1', 'StuH 42', 'StuG IIIG (L)', 'PzKw IIIN', 'Sherman III(a)@ru', 'PzKw VIE (L)', 'PzKw IVD', 'PzKw 35t', 'PzKw IIF', 'KV-2', 'BT-7 M37', 'IS-2', 'T-34/85', 'PzKw VG', 'PzKw VIB', 'PzKw IVJ', 'Mark VIB', 'JgdPz 38(t)', 'M4A2(L)@am', 'M4A3@am', 'M4A3E2@am', 'PzKw IIA', 'M5A1@am', 'PzKw IIIG', 'KV-1 M41', 'StuG IIIG', 'PSW 234/2', 'Cromwell IV', 'Sherman IIA(a)@br', 'Daimler AC', 'Type 97B CHI-HA', 'Type 89B CHI-RO', 'Type 95 HA-GO', 'M8 AC@am'];
const MARKERS = [
  'MS/pin', 'MS/dm', 'MS/cx', 'MS/FirePrep', 'MS/FireAdv', 'MS/First', 'MS/Final', 'MS/Melee', 'MS/CC', 'MS/Wound',
  'MS/RFP01', 'MS/RFP02', 'MS/RFP04', 'MS/RFP06', 'MS/RFP08', 'MS/RFP12', 'ML/Smk2', 'ML/Smk3', 'ML/WP1', 'ML/WP2',
  // SK2 ordnance: Acquired Target -1/-2, malfunctioned and limbered Guns, the "?" of a hidden Gun.
  'MS/acq1wh', 'MS/acq2wh', 'MS/MalfGun', 'MS/Limbered', 'br/brqmark=qmark-br', 'al/alqmark=qmark-al', 'ge/geqmark=qmark-ge',
  'ru/ruqmark=qmark-ru', 'am/amqmark=qmark-am', 'it/itqmark=qmark-it',
  // SK4 Pacific: the Japanese "?" and the Banzai counter (front "Banzai", back "+1 Ambush").
  'ja/jaqmark=qmark-ja', 'MS/Banzai',
  // Full ASL: the Level counters an upper building level's units sit on (ASLRB B23.421).
  'ML/Lev1', 'ML/Lev2',
  // Full ASL Fire and rubble (ASLRB B25, B24): Flame and Blaze, rubble, the Wind Direction counter in its six directions and
  // its force faces, the Gust/Change face, TI and Labor (B24.7, B24.8), grey drifting Smoke.
  'MS/Flame', 'MS/Blaze', 'ML/Rubble', 'ML/Wind1', 'ML/Wind2', 'ML/Wind3', 'ML/Wind4', 'ML/Wind5', 'ML/Wind6', 'ML/WindNo', 'ML/WindMB', 'ML/WindHW', 'ML/WindB',
  'MS/ti=TI', 'MS/Labor1', 'MS/Labor2', 'ML/Smk2gr',
  // The ½" Smoke grenade counter (SK4 3.3.1; ASLRB A24.1): +2, gone at the end of the Player Turn.
  'MS/Smk12',
  // Full ASL minefields (ASLRB B28): the blank Known/revealed-presence counter, the A-P strengths, the A-T factors, the
  // Dummy face and the arrowed Known Minefield counters (B28.46).
  'MS/Mine', 'MS/MineD', 'MS/MineAP06', 'MS/MineAP08', 'MS/MineAP12', 'MS/KnownMineleft', 'MS/KnownMineright',
  // SK3 vehicles: Motion, Bog/Mired/Immobilized, Shock/UK, Stun (+1 side), STUN/Recall, Low Ammo, vehicle
  // acquisition, Bounding Fire, malfunctioned/disabled MA and MGs, and the CE/BU turret counters (one
  // orientation each; the client turns them to the Turret Covered Arc) and the non-turreted CE/BU markers.
  'MS/Motion', 'MS/Bog', 'MS/Mired', 'MS/Immob', 'MS/Shock', 'MS/UK', 'MS/stun=Stun', 'MS/StunB=StunPlus1', 'MS/STUNR', 'MS/STUNRB=Recall',
  'MS/LowAmmo', 'MS/acq1tr', 'MS/acq2tr', 'MS/FireBnd', 'MS/MalfMA', 'MS/DisMA', 'MS/MalfBMG', 'MS/MalfCMG', 'MS/MalfAAMG', 'MS/MalfRMG',
  'MS/DisBMG', 'MS/DisCMG', 'MS/DisAAMG', 'MS/DisRMG',
  'ge/geCE3=turret-ce-ge', 'ge/geBU3=turret-bu-ge', 'ru/ruCE3=turret-ce-ru', 'ru/ruBU3=turret-bu-ru', 'ge/geCEnt=ce-ge', 'ge/geBUnt=bu-ge', 'ru/ruCEnt=ce-ru', 'ru/ruBUnt=bu-ru',
];

/**
 * Fortification counters VASL builds from layers (ASLRB B26, B27, B29, B30): a colour square under the drawing and,
 * for a foxhole or pillbox, the size or strength layer; composited as the module stacks them (`layeredMarker`).
 */
const LAYERED_MARKERS: Record<string, string[]> = {
  Foxhole1S: ['ML/_brownd58', 'ML/Foxhole', 'ML/Fox1'],
  Foxhole2S: ['ML/_brownd58', 'ML/Foxhole', 'ML/Fox2'],
  Foxhole3S: ['ML/_brownd58', 'ML/Foxhole', 'ML/Fox3'],
  Trench: ['ML/_brownd58', 'ML/Trench'],
  ATditch: ['ML/_brownd58', 'ML/ATditch'],
  Wire: ['ML/_white58', 'ML/Wire'],
  Roadblock: ['ML/_white58', 'ML/Rdblk'],
  // The A-T mine SVGs embed a picture the module no longer ships, so their GIF faces are used, on the white square.
  ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`MineAT${n}`, ['MS/_white12', `MS/MineAT${n}`]])),
  ...Object.fromEntries(
    [1, 2, 3].flatMap((cap) => [
      [`Pillbox${cap}35`, ['ML/_brownd58', `ML/PillNCap${cap}`, 'ML/PillN35']],
      [`Pillbox${cap}46`, ['ML/_brownd58', `ML/PillNCap${cap}`, 'ML/PillN46']],
      [`Pillbox${cap}57`, ['ML/_gray58', `ML/PillNCap${cap}`, 'ML/PillN57']],
    ]),
  ),
};

function args() {
  const out: { vmod?: string; boards: Record<string, string>; skipArt: boolean; onlyMarkers: boolean } = { boards: {}, skipArt: false, onlyMarkers: false };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--vmod') out.vmod = a[++i];
    else if (a[i] === '--board') {
      const [b, p] = a[++i]!.split('=');
      out.boards[b!] = p ?? DEFAULTS.board(b!);
    } else if (a[i] === '--skip-art') out.skipArt = true;
    // Markers only: the counters and boards of the committed manifest are kept as they are (the HD counter art is not re-rendered).
    else if (a[i] === '--only-markers') out.onlyMarkers = true;
  }
  if (Object.keys(out.boards).length === 0) for (const b of ['y', 'z', 'x']) out.boards[b] = DEFAULTS.board(b);
  return out;
}

async function load(pathOrUrl: string): Promise<Uint8Array> {
  if (!/^https?:/.test(pathOrUrl)) return readFileSync(pathOrUrl);
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, pathOrUrl.split('/').pop()!);
  if (existsSync(file)) return readFileSync(file);
  console.log(`downloading ${pathOrUrl}`);
  const res = await fetch(pathOrUrl);
  if (!res.ok) throw new Error(`${res.status} fetching ${pathOrUrl}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  writeFileSync(file, buf);
  return buf;
}

const write = (file: string, data: string | Uint8Array) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};

async function main() {
  const opts = args();
  const vmod = unzipSync(await load(opts.vmod ?? DEFAULTS.vmod));
  const text = (p: string) => (vmod[p] ? new TextDecoder().decode(vmod[p]) : undefined);
  const buildFile = text('buildFile') ?? text('buildFile.xml');
  if (!buildFile) throw new Error('vmod has no buildFile');
  const version = text('moduledata')?.match(/<version>([^<]+)</)?.[1] ?? 'unknown';

  // Fonts for rasterizing counters.
  const fontDir = join(cacheDir, 'fonts');
  const fontFiles: string[] = [];
  for (const [p, data] of Object.entries(vmod)) {
    if (p.startsWith('images/fonts/') && p.endsWith('.ttf')) {
      const f = join(fontDir, p.split('/').pop()!);
      write(f, data);
      fontFiles.push(f);
    }
  }

  // ------------------------------------------------------------ counters
  const svgOf = (img: string) => text(`images/${img.slice(0, 2)}/${img}.svg`);
  const gunSvgOf = (img: string) => text(`images/${img.slice(0, 2)}/gun/${img}.svg`);
  const result = buildCounters({ nationalities: NATIONALITIES, slots: pieceSlots(buildFile), readSvg: svgOf, guns: gunSlots(buildFile), readGunSvg: gunSvgOf, keepGun, mortars: MORTARS, latw: LATW, infos: pieceInfos(buildFile) });
  // Vehicles (SK3): front art is an SVG under images/<nat>/veh/, the wreck side the wreck piece's GIF.
  for (const v of vehicleSlots(buildFile, VEHICLES)) {
    const nat = v.nat;
    const svg = text(`images/${nat}/veh/${v.image}.svg`);
    const parsed = svg ? parseVehicleSvg(svg, v.info) : null;
    if (!parsed) {
      result.warnings.push(`no vehicle values for ${v.name}`);
      continue;
    }
    // "ruShermanIII" → ru.ShermanIII: the art name's own nationality prefix is dropped.
    const id = `${nat}.${v.image.startsWith(nat) ? v.image.slice(nat.length) : v.image}`;
    // The inherent crew's morale is the nationality's best elite Infantry MMC (SK4 7.9).
    const crewMorale = Math.max(...Object.values(result.counters).filter((d): d is MmcDef => d.kind === 'squad' && d.nationality === nat && d.quality === 'E').map((d) => d.morale), 7);
    const def: VehicleDef = { id, nationality: nat, name: v.name, ...parsed, ...(v.openTopped ? { openTopped: true } : {}), ceDrm: 2, crewMorale, cvp: 0 };
    // Russian Vehicle Note M (SK3): early-war Russian tracked AFV with a red MP stall on an 11.
    if (nat === 'ru' && def.redMp && def.tracked) def.stallOn11 = true;
    result.counters[id] = def;
    const wreckDir = `${v.wreckNat ?? nat}/veh`;
    const wreckOk = v.wreck && (vmod[`images/${wreckDir}/${v.wreck}.gif`] || vmod[`images/${wreckDir}/${v.wreck}.svg`]);
    result.images[id] = { front: v.image, ...(wreckOk ? { back: v.wreck! } : {}), dir: `${nat}/veh`, ...(wreckOk && v.wreckNat ? { backDir: wreckDir } : {}) };
    if (!wreckOk) result.warnings.push(`no wreck art for ${v.name}`);
  }
  console.log(`counters: ${Object.keys(result.counters).length} (${result.warnings.length} warnings)`);
  for (const w of result.warnings.filter((x, i) => i < 20 || /vehicle|wreck/.test(x))) console.log(`  warn: ${w}`);

  const manifest: {
    source: { vasl: string };
    counters: Record<string, { front: string; back?: string; limbered?: string }>;
    markers: Record<string, string>;
    boards: Record<string, { image: string; width: number; height: number; hasHills?: boolean }>;
  } = { source: { vasl: version }, counters: {}, markers: {}, boards: {} };

  const src = { read: (p: string) => vmod[`images/${p}`], fontFiles };
  // Markers only: those the committed manifest already has keep their art (the counter-art polish included).
  const prevMarkers: Record<string, string> = opts.onlyMarkers ? (JSON.parse(readFileSync(join(genDir, 'assets.json'), 'utf8')) as { markers: Record<string, string> }).markers : {};
  const rendered = new Set<string>();
  const render = async (img: string, dir: string) => {
    const out = `counters/${img}.webp`;
    if (rendered.has(out) || opts.skipArt || opts.onlyMarkers) return out;
    const svg = text(`images/${dir}/${img}.svg`);
    if (svg) write(join(artDir, out), await rasterizeCounter(svg, dir, src));
    else {
      const gif = vmod[`images/${dir}/${img}.gif`];
      if (!gif) throw new Error(`no art for ${img}`);
      write(join(artDir, out), await toWebp(gif, { lossless: true }));
    }
    rendered.add(out);
    return out;
  };
  for (const [id, imgs] of Object.entries(result.images).sort()) {
    const dir = imgs.dir ?? imgs.front.slice(0, 2);
    manifest.counters[id] = {
      front: await render(imgs.front, dir),
      ...(imgs.back ? { back: await render(imgs.back, imgs.backDir ?? dir) } : {}),
      ...(imgs.limbered ? { limbered: await render(imgs.limbered, dir) } : {}),
    };
  }
  for (const m of MARKERS) {
    // "dir/image" or "dir/image=key" when the client's name must differ from VASL's.
    const [path, key] = m.split('=') as [string, string | undefined];
    const [dir, name] = path.split('/') as [string, string];
    const svg = text(`images/${dir}/${name}.svg`);
    const gif = vmod[`images/${dir}/${name}.gif`] ?? vmod[`images/${dir}/${name}.png`];
    const out = `markers/${key ?? name}.webp`;
    if (prevMarkers[key ?? name]) {
      manifest.markers[key ?? name] = prevMarkers[key ?? name]!;
      continue;
    }
    if (!opts.skipArt) {
      if (svg) write(join(artDir, out), await rasterizeCounter(svg, dir, src));
      else if (gif) write(join(artDir, out), await toWebp(gif, { lossless: true }));
      else {
        console.log(`  warn: no marker art for ${m}`);
        continue;
      }
    }
    manifest.markers[key ?? name] = out;
  }
  for (const [key, layers] of Object.entries(LAYERED_MARKERS)) {
    const out = `markers/${key}.webp`;
    if (prevMarkers[key]) {
      manifest.markers[key] = prevMarkers[key]!;
      continue;
    }
    const data = layers.map((l) => vmod[`images/${l}.gif`]);
    if (data.some((d) => !d)) {
      console.log(`  warn: missing layer for ${key}`);
      continue;
    }
    if (!opts.skipArt) write(join(artDir, out), await layeredMarker(data as Uint8Array[]));
    manifest.markers[key] = out;
  }
  // The Starter Kit Cave counter and its Open Ground back (S70), composed from VASL's full ASL Cave drawing.
  {
    const gif = vmod['images/ML/Cave.gif'];
    if (gif) {
      for (const [key, side] of [['Cave', 'front'], ['CaveOG', 'back']] as const) {
        const out = `markers/${key}.webp`;
        if (!opts.skipArt) write(join(artDir, out), await skCaveMarker(gif, side));
        manifest.markers[key] = out;
      }
    } else console.log('  warn: no ML/Cave.gif for the Cave counter');
  }

  // ------------------------------------------------------------ boards
  const boardsOut: Record<string, unknown> = {};
  if (opts.onlyMarkers) {
    const prev = JSON.parse(readFileSync(join(genDir, 'assets.json'), 'utf8')) as typeof manifest;
    manifest.counters = prev.counters;
    manifest.boards = prev.boards;
    manifest.markers = { ...prev.markers, ...manifest.markers };
    // The committed manifest is two-space indented.
    write(join(genDir, 'assets.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`wrote the markers to ${artDir} and ${genDir}/assets.json`);
    return;
  }
  for (const [b, p] of Object.entries(opts.boards)) {
    const zip = unzipSync(await load(p));
    const los = zip['LOSData'];
    const gif = zip[`bd${b}.gif`];
    if (!los || !gif) throw new Error(`board ${b}: missing LOSData or image`);
    const grid = decodeLosData(los);
    const data = deriveBoard(b, grid);
    for (const w of data.warnings.slice(0, 10)) console.log(`  warn: ${w}`);
    if (data.review.length) console.log(`  ${data.review.length} close calls to check against the art: pnpm --filter @asl/vasl-import run audit`);
    boardsOut[b] = { hexes: data.hexes, roadHexsides: data.roadHexsides };
    // Terrain raster (row-major codes), deflated + base64, for pixel LOS; the elevation raster
    // (int8 + 128) only for boards with hills, so flat boards' files do not change.
    const elev = grid.hasHills
      ? `, elev: '${deflateSync(Uint8Array.from(grid.elevation, (e) => e + 128), { level: 9 }).toString('base64')}'`
      : '';
    write(
      join(genDir, `los-${b}.ts`),
      `// Generated by tools/vasl-import from VASL board ${b} LOSData. Do not edit.\n` +
        `export const LOS_${b.toUpperCase()} = { w: ${grid.w}, h: ${grid.h}, data: '${deflateSync(grid.terrain, { level: 9 }).toString('base64')}'${elev} };\n`,
    );
    const imgOut = `boards/${b}.webp`;
    // Boards whose art is a high-resolution redraw (NOTICE.md) keep it: only the VASL boards get VASL art.
    if (!opts.skipArt && !REDRAWN_BOARDS.has(b)) write(join(artDir, imgOut), await toWebp(gif, { lossless: true }));
    manifest.boards[b] = { image: imgOut, width: grid.w, height: grid.h, ...(grid.hasHills ? { hasHills: true } : {}) };
    console.log(`board ${b}: ${Object.keys(data.hexes).length} hexes, ${data.roadHexsides.length} road hexsides, ${new Set(Object.values(data.hexes).map((h) => h.buildingId).filter(Boolean)).size} buildings`);
  }

  write(join(genDir, 'counters.json'), JSON.stringify(result.counters, null, 1) + '\n');
  write(join(genDir, 'assets.json'), JSON.stringify(manifest, null, 1) + '\n');
  write(join(genDir, 'boards.json'), JSON.stringify(boardsOut) + '\n');
  console.log(`wrote ${genDir} and ${artDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
