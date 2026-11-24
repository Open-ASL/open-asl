import { useMemo } from 'react';
import { serviceCatalogue, scenarioById } from '@asl/content';
import { scenarioRuleset } from '@asl/rules';
import { COMPUTER_OPPONENTS, NATIONS, emptyServiceRecord, measureAll, type AwardContext, type AwardedMedal, type Medal, type MeasurePart, type ServiceScenario, type UserDoc } from '@asl/platform';
import ribbonSources from '../../../art/ribbons/sources.json';
import { toDate } from '../../ui/time';

const RIBBON_FILES = new Map((ribbonSources as { id: string; file: string }[]).map((r) => [r.id, r.file]));

/** The decorations' catalogue: every scenario players can play, with the sides the computer opponent takes. */
export const useServiceCatalogue = (): ServiceScenario[] => useMemo(() => serviceCatalogue(COMPUTER_OPPONENTS), []);

/** A player's own record measured against every decoration. */
export function useOwnMeasures(user: Pick<UserDoc, 'service' | 'betaScenarios'> | null) {
  const catalogue = useServiceCatalogue();
  return useMemo(() => {
    if (!user) return null;
    const ctx: AwardContext = { record: user.service ?? emptyServiceRecord(), catalogue, betaScenarios: user.betaScenarios ?? [] };
    return { ctx, measures: measureAll(ctx) };
  }, [user, catalogue]);
}

/** The held decorations that are current, by id. Records may still carry retired ones. */
export const heldById = (medals: readonly AwardedMedal[], known: readonly Medal[]) =>
  new Map(medals.filter((m) => known.some((k) => k.id === m.id)).map((m) => [m.id, m]));

export const awardedOn = (at: unknown) => toDate(at)?.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) ?? 'recently';

export const nationName = (m: Medal) => NATIONS[m.nation];

/** The lobby link that deploys a scenario with a side chosen, against a player or the computer. */
export function deployLink(scenarioId: string, side: string, vsComputer: boolean): string {
  const def = scenarioById(scenarioId);
  const ruleset = def ? scenarioRuleset(def) : 'starter-kit';
  return `/app/${ruleset}/games?scenario=${encodeURIComponent(scenarioId)}&side=${encodeURIComponent(side)}${vsComputer ? '&vs=computer' : ''}`;
}

/**
 * Devices for each level beyond the first, as worn: bronze stars, a silver star standing for five; oak leaves for a
 * mention. A class (the Order of Glory) shows as stars too.
 */
function Devices({ medal, level }: { medal: Medal; level: number }) {
  const extra = Math.max(0, level - 1);
  if (!extra || !medal.device) return null;
  if (medal.device === 'oak-leaf') return <span className="ribbon-devices">{Array.from({ length: Math.min(extra, 4) }, (_, i) => <i key={i} className="device oak" aria-hidden />)}</span>;
  const silver = Math.floor(extra / 5);
  const bronze = extra % 5;
  const marks = [...Array(silver).fill('silver'), ...Array(bronze).fill('bronze')].slice(0, 5);
  return <span className="ribbon-devices">{marks.map((m, i) => <i key={i} className={`device star ${m}`} aria-hidden />)}</span>;
}

/** A decoration's ribbon, with its devices. */
export function Ribbon({ medal, level = 1, size = 'rack' }: { medal: Medal; level?: number; size?: 'rack' | 'card' | 'large' }) {
  const label = `${medal.name}${level > 1 ? `, ${levelLabel(medal, level)}` : ''}`;
  if (medal.stripes) {
    const stripes = [...medal.stripes, ...medal.stripes.slice(0, -1).reverse()];
    const w = 100 / stripes.length;
    const gradient = stripes.map((c, i) => `${c} ${i * w}% ${(i + 1) * w}%`).join(', ');
    return <span className={`ribbon ribbon-${size}`} style={{ background: `linear-gradient(90deg, ${gradient})` }} role="img" aria-label={label}><Devices medal={medal} level={level} /></span>;
  }
  const file = RIBBON_FILES.get(medal.id);
  return <span className={`ribbon ribbon-${size} ribbon-image`} role="img" aria-label={label}>
    {file && <img src={`/ribbons/${file}`} alt="" draggable={false} />}
    <Devices medal={medal} level={level} />
  </span>;
}

/** A supreme decoration's picture of the medal itself. */
export function MedalImage({ medal, size = 'rack' }: { medal: Medal; size?: 'rack' | 'card' | 'large' }) {
  return <img className={`medal-art medal-art-${size}`} src={`/medals/${medal.id}.webp`} alt={medal.name} draggable={false} />;
}

/** The decoration as shown in lists: the medal for the supreme ones, the ribbon for the rest. */
export function DecorationThumb({ medal, level = 1, size = 'card' }: { medal: Medal; level?: number; size?: 'rack' | 'card' | 'large' }) {
  return medal.art ? <MedalImage medal={medal} size={size} /> : <Ribbon medal={medal} level={level} size={size} />;
}

/** "2nd Class", "3 awards" and the like for a level. */
export function levelLabel(m: Medal, level: number): string {
  if (m.classes) return m.classes[Math.min(level, m.classes.length) - 1] ?? '';
  if (m.id === 'us-eame-campaign' || m.id === 'us-asiatic-pacific-campaign') return `${level - 1} battle star${level === 2 ? '' : 's'}`;
  return `${level} awards`;
}

export function PartBars({ parts }: { parts: MeasurePart[] }) {
  return <div className="award-parts">
    {parts.map((p) => {
      const share = p.goal > 0 ? Math.min(1, p.value / p.goal) : 1;
      return <div key={p.label} className="award-part">
        <span className="award-part-label">{p.label}</span>
        <div className="xp-bar" role="progressbar" aria-label={p.label} aria-valuenow={Math.min(p.value, p.goal)} aria-valuemin={0} aria-valuemax={p.goal}><span style={{ width: `${Math.round(share * 100)}%` }} /></div>
        <span className="award-part-count">{Math.min(p.value, p.goal)} / {p.goal}</span>
      </div>;
    })}
  </div>;
}
