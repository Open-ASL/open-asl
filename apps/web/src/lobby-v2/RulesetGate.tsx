import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Emblem } from '../ui/Emblem';
import { useRulesets } from './ruleset';

export function RulesetGate() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rulesets = useRulesets();
  const remembered = rulesets.find((r) => r.enabled && r.id === sessionStorage.getItem('asl.ruleset'));
  if (remembered && params.get('change') !== '1') return <Navigate to={`/app/${remembered.id}/home`} replace />;
  return (
    <main className="ruleset-gate">
      <div className="ruleset-gate__mark"><Emblem /></div>
      <p className="eyebrow">Choose your field manual</p>
      <h1>How do you want to play?</h1>
      <p className="ruleset-gate__intro">Your choice filters every scenario, opponent, table, and result in the Lobby. You can change it at any time.</p>
      <div className="ruleset-options">
        {rulesets.map((ruleset) => (
          <button
            key={ruleset.id}
            className={`ruleset-option ${ruleset.enabled ? '' : 'is-disabled'}`}
            disabled={!ruleset.enabled}
            onClick={() => { sessionStorage.setItem('asl.ruleset', ruleset.id); navigate(`/app/${ruleset.id}/home`); }}
          >
            <span className="ruleset-option__status">{!ruleset.enabled ? 'Coming soon' : ruleset.id === 'full-asl' ? 'In development' : 'Available now'}</span>
            <b>{ruleset.name}</b>
            <span>{ruleset.description}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
