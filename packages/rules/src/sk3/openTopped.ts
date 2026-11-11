import type { RuleModule } from '@asl/engine';
import { pieceOf, setTags } from '../sk1/status';
import { T3, isCe, vehicle } from './status';

/*
 * Open-Topped AFVs (SK4 7.13): CE unless Buttoned Up (or Shocked/Stunned); −1 on the IFT DR of an
 * Area Target Type attack against them; −2 in Close Combat; a Pin result leaves the crew CE but
 * pinned for the Player Turn (+2 To Hit as a pinned firer, MG/IFE halved, no Intensive Fire or ROF);
 * BU they fire only bow-mounted MG; a FT's TK is 2 higher against them (in the FT rule). The
 * vehicle MG and MA legality rules read the `otPinned` and BU state directly.
 */

export const OT_PINNED = 'otPinned';

export const openToppedModule: RuleModule = {
  id: 'sk3.openTopped',
  ref: 'SK4 7.13',
  summary: 'Open-Topped AFVs: CE by default, Area Target Type −1, CC −2, pinned crews, bow MG only when BU.',
  requires: ['sk3.vehicles', 'sk3.vehicleFire', 'sk3.cc'],
  install(r) {
    r.contribute({
      id: 'sk3.ot.att',
      query: 'fire.unitDrm',
      ref: 'SK4 7.13',
      label: '-1 Open-Topped (Area Target Type)',
      when: ({ attack, unit }, env) => attack.ordnance?.targetType === 'ATT' && !!vehicle(env, pieceOf(env, unit))?.openTopped,
      apply: (v) => v - 1,
    });
    r.contribute({
      id: 'sk3.ot.th.pinned',
      query: 'ordnance.thDrm',
      ref: 'case 2',
      label: '+2 pinned crew (Open-Topped)',
      when: ({ firerVehicle }, env) => !!firerVehicle && pieceOf(env, firerVehicle).tags[OT_PINNED] === true,
      apply: (v) => v + 2,
    });
    r.contribute({
      id: 'sk3.ot.mg.pinned',
      query: 'fire.partFp',
      layer: 200,
      ref: 'SK4 7.13',
      label: '½ pinned crew (Open-Topped)',
      when: ({ part }, env) => {
        const p = env.state.pieces[part.piece];
        const holder = p?.loc.kind === 'held' ? env.state.pieces[p.loc.by] : undefined;
        return !!holder && holder.tags[OT_PINNED] === true;
      },
      apply: (v) => v / 2,
    });
    r.contribute({
      id: 'sk3.ot.no-intensive',
      query: 'ordnance.maIllegal',
      apply(v, { shot }, env) {
        if (v) return v;
        const p = env.state.pieces[shot.weapon];
        const d = p && vehicle(env, p);
        if (!p || !d) return v;
        if (d.openTopped && !isCe(p)) return 'An Open-Topped AFV cannot fire its Main Armament while Buttoned Up';
        if (p.tags[OT_PINNED] && shot.intensive) return 'A pinned crew may not use Intensive Fire';
        return null;
      },
    });
    // The pin expires with the Player Turn, as every Pin does (SK1 3.8).
    r.on<{ phase: string }>({
      id: 'sk3.ot.unpin',
      event: 'turn.phaseEnded',
      handler(ctx, ev) {
        if (ev.payload.phase !== 'CCPh') return;
        for (const p of Object.values(ctx.state.pieces).sort((a, b) => (a.id < b.id ? -1 : 1))) if (p.tags[OT_PINNED]) setTags(ctx, p.id, { [OT_PINNED]: null });
      },
    });
    void T3;
  },
};
