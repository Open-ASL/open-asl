import type { HexId } from '@asl/engine';

/**
 * What a right-click on `hex` offers while a moving vehicle has a Bounding First Fire shot lined up (SK4 3.3.2.2):
 * the MA's shot ('gun': fire, preview, cancel) or the picked MGs' ('mg'), at any hex but the mover's own. Null leaves
 * the wheel as usual: the mover's own hex keeps its move orders (stop, delay, turn).
 */
export function bffWheelKind(o: { decisionKind: string | undefined; phase: string; moverHex: HexId | null | undefined; vehicle: boolean; hex: HexId; gunLinedUp: boolean; mgMode: boolean }): 'gun' | 'mg' | null {
  if (o.decisionKind !== 'phase' || o.phase !== 'MPh' || !o.vehicle || o.hex === o.moverHex) return null;
  return o.gunLinedUp ? 'gun' : o.mgMode ? 'mg' : null;
}
