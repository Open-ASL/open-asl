/**
 * Checks the board terrain the import would derive against the committed data and lists the close calls.
 * Run after changing `deriveBoard` or adding a board, and look at every listed hex in the board art:
 *
 *   pnpm --filter @asl/vasl-import run audit [board...]
 *
 * Reads the cached VASL boards (`cache/bd<letter>`, fetched by an import) and
 * `packages/content/src/generated/boards.json`; writes nothing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { decodeLosData, deriveBoard } from './boards';

const root = join(import.meta.dirname, '../../..');
const committed = JSON.parse(readFileSync(join(root, 'packages/content/src/generated/boards.json'), 'utf8')) as Record<
  string,
  { hexes: Record<string, unknown>; roadHexsides: [string, string][] }
>;
const boards = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(committed).sort();
for (const b of boards) {
  const file = join(root, 'tools/vasl-import/cache', `bd${b}`);
  if (!existsSync(file)) {
    console.log(`board ${b}: no cached VASL board (run the import with --board ${b} first)`);
    continue;
  }
  const d = deriveBoard(b, decodeLosData(unzipSync(readFileSync(file))['LOSData']!));
  const old = committed[b];
  const changed = Object.entries(d.hexes).filter(([id, h]) => JSON.stringify(old?.hexes[id]) !== JSON.stringify(h));
  const roads = JSON.stringify(old?.roadHexsides) === JSON.stringify(d.roadHexsides);
  console.log(`board ${b}: ${changed.length} hexes differ from boards.json${roads ? '' : ', road hexsides differ'}, ${d.review.length} close calls`);
  for (const [id, h] of changed) console.log(`  ${id}: ${JSON.stringify(old?.hexes[id])} -> ${JSON.stringify(h)}`);
  for (const w of d.warnings) console.log(`  warn: ${w}`);
  for (const r of d.review) console.log(`  check ${r}`);
}
