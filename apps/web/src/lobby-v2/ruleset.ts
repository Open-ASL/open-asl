import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { RULESETS, isRulesetId, rulesetsFor, type RulesetId, type RulesetInfo } from '@asl/platform';
import { useMember } from '../auth/AuthProvider';
import { usingEmulators } from '../firebase';

/**
 * The development gate for Full ASL: on for a local build against the emulators (`pnpm dev`), and
 * for an account with the `admin` custom claim; off for everyone else, who sees it as coming soon.
 * The server applies the same gate (`fullAslOpen` in functions/src/lib/scenarios.ts). `null` while
 * the claim is being read.
 */
export function useFullAslGate(): boolean | null {
  const { user } = useMember();
  const [admin, setAdmin] = useState<boolean | null>(usingEmulators ? true : null);
  useEffect(() => {
    if (usingEmulators) return;
    let live = true;
    void user.getIdTokenResult().then((t) => live && setAdmin(t.claims.admin === true), () => live && setAdmin(false));
    return () => { live = false; };
  }, [user]);
  return admin;
}

/** The rulesets this player may enter (Full ASL only behind the gate). */
export function useRulesets(): ReadonlyArray<RulesetInfo> {
  return rulesetsFor(useFullAslGate() === true);
}

/** The ruleset of the lobby being shown, from the route (`/app/:ruleset/...`). */
export function useLobbyRuleset(): RulesetId {
  const { ruleset } = useParams<{ ruleset: string }>();
  return isRulesetId(ruleset) ? ruleset : 'starter-kit';
}

export const rulesetName = (id: RulesetId): string => RULESETS.find((r) => r.id === id)?.name ?? id;
