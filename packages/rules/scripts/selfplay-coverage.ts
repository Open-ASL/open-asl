/* Counts which actions/events random self-play exercises. */
import { playRandom } from '../test/selfplay-lib';

const actions = new Map<string, number>();
const events = new Map<string, number>();
const results = new Map<string, number>();
for (let i = 1; i <= Number(process.argv[2] ?? 25); i++) {
  const r = playRandom(i);
  for (const a of r.actions) actions.set(a.type, (actions.get(a.type) ?? 0) + 1);
  for (const e of r.log) {
    let k = e.type;
    if (e.type === 'sk1.check') k += `:${(e.payload as { kind: string; outcome: string }).kind}:${(e.payload as { outcome: string }).outcome}`;
    if (e.type === 'sk1.cc.attack') k += `:${(e.payload as { result: string }).result}`;
    if (e.type === 'piece.eliminated') k += `:${(e.payload as { reason: string }).reason}`;
    events.set(k, (events.get(k) ?? 0) + 1);
  }
  const res = `${r.state.result?.winner}:${r.state.result?.reason}`;
  results.set(res, (results.get(res) ?? 0) + 1);
}
console.log('ACTIONS', Object.fromEntries([...actions].sort()));
console.log('EVENTS', Object.fromEntries([...events].sort()));
console.log('RESULTS', Object.fromEntries(results));
