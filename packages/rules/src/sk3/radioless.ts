import type { PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { statics } from '../common/pieces';
import { pieceOf, setTags } from '../sk1/status';
import { movingVehicle } from './vehicleMove';

/*
 * Radioless AFV (SSR; ASL D14 in brief): "To represent its radioless condition, the Russian BT-7 M37
 * must make a DR ≤ 8 each MPh it wishes to move outside of its hex" (S25 SSR 1). The DR is made once
 * per MPh, as the AFV starts moving; failed, it may still start, stop, turn and Delay in its hex
 * but may not leave it this MPh.
 */

export const RADIOLESS_MODULE = 'radioless';

export interface RadiolessParams {
  /** Vehicle counter defs that are radioless, e.g. ['ru.BT7M37']. */
  defs: string[];
  /** The DR must be ≤ this to leave its hex. */
  need: number;
  /** The card's name for the rule, e.g. 'SSR 1'. */
  rule?: string;
}

/** Tags: the Game Turn and ATTACKER of the MPh the DR was made in, and whether it was passed. */
const TAG_TURN = 'radioTurn';
const TAG_OK = 'radioOk';

export const radiolessOf = (env: QueryEnv, defId: string): RadiolessParams | null =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === RADIOLESS_MODULE)
    .map((s) => s.params as unknown as RadiolessParams)
    .find((q) => q?.defs.includes(defId)) ?? null;

const mphKey = (env: QueryEnv) => `${env.state.turn}:${env.state.attacker}`;

/** Why a radioless AFV may not leave its hex this MPh, or null. */
export function radiolessIllegal(env: QueryEnv, vehicleId: PieceId): string | null {
  const p = pieceOf(env, vehicleId);
  const q = radiolessOf(env, p.defId);
  if (!q || p.tags[TAG_TURN] !== mphKey(env) || p.tags[TAG_OK] !== false) return null;
  return `Radioless${q.rule ? ` (${q.rule})` : ''}: it failed its DR ≤ ${q.need} this MPh and may not leave its hex`;
}

export const radiolessModule: RuleModule = {
  id: 'ssr.radioless',
  summary: 'Radioless AFV: a DR each MPh decides whether it may leave its hex (SSR).',
  requires: ['sk3.vehicleMove'],
  install(r) {
    r.event<{ vehicle: PieceId; dr: [number, number]; need: number; ok: boolean; rule?: string }>({ type: 'ssr.radioless', apply() {} });
    r.on<{ vehicle: PieceId; kind: string }>({
      id: 'ssr.radioless.roll',
      event: 'sk3.vehicle.move',
      handler(ctx, ev) {
        if (ctx.state.phase !== 'MPh' || (ev.payload.kind !== 'start' && ev.payload.kind !== 'restart')) return;
        const p = pieceOf(ctx, ev.payload.vehicle);
        const q = radiolessOf(ctx, p.defId);
        if (!q || p.tags[TAG_TURN] === mphKey(ctx)) return;
        const roll = ctx.roll(`Radioless: ${p.id} needs DR ≤ ${q.need} to leave its hex`);
        const ok = roll.total <= q.need;
        setTags(ctx, p.id, { [TAG_TURN]: mphKey(ctx), [TAG_OK]: ok });
        ctx.emit('ssr.radioless', { vehicle: p.id, dr: roll.dice as [number, number], need: q.need, ok, ...(q.rule ? { rule: q.rule } : {}) });
      },
    });
    r.contribute({
      id: 'ssr.radioless.step',
      query: 'vehicle.stepIllegal',
      layer: 10,
      apply(v, { ms, to }, env) {
        if (v) return v;
        const m = movingVehicle(env);
        if (!m || to === ms.hex) return null;
        return radiolessIllegal(env, m.p.id);
      },
    });
  },
};
