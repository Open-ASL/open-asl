import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BriefingDialog } from '../panels/Briefing';
import { matchScenario } from '../match/scenarios';

/**
 * A scenario's name anywhere in the Lobby: click it and the card opens in the briefing dialog,
 * with any balance provisions of that game applied. Falls back to plain text for an unknown id.
 * The dialog is portalled to the body so it does not inherit the font of the heading or row it was opened from.
 */
export function ScenarioLink({ scenarioId, balance = [], children, className = '' }: { scenarioId: string; balance?: string[]; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const scenario = matchScenario(scenarioId, balance);
  if (!scenario) return <>{children}</>;
  return <>
    <button type="button" className={`scenario-link ${className}`} title="Open the scenario card" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>{children}</button>
    {open && createPortal(<BriefingDialog scenario={scenario} onClose={() => setOpen(false)} />, document.body)}
  </>;
}
