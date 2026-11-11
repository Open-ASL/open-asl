/* Benchmark/profiling entry: plays random games and reports timing. */
import { playRandom } from '../test/selfplay-lib';

const n = Number(process.argv[2] ?? 5);
const t0 = performance.now();
let steps = 0;
for (let i = 1; i <= n; i++) steps += playRandom(i).steps;
const ms = performance.now() - t0;
console.log(`${n} games, ${steps} actions, ${ms.toFixed(0)} ms (${(ms / steps).toFixed(2)} ms/action)`);
