import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { Emblem } from '../../ui/Emblem';

const FEATURES = [
  { title: 'The engine is the referee', body: 'Every phase, every die roll and every rule is resolved by the rules engine. Nothing to look up, nothing to argue.' },
  { title: 'Starter Kit rules, complete', body: 'Infantry, support weapons, Guns and ordnance, vehicles and armoured combat, and the Pacific, played to the ASL Starter Kit rules.' },
  { title: 'Full ASL under way', body: 'Multi-level Locations, buildings and hills, and the rest of Chapter A, built rule by rule on the same engine.' },
  { title: 'Hotseat and online', body: 'Play both sides at one screen, or live online with clocks, open seats, challenges, chat and spectating.' },
  { title: 'After Action Reports', body: 'Every finished game gets a report: the story of the battle, the casualties, the turning points and a replay.' },
  { title: 'Scenario atlas', body: 'Every scenario on a globe, searchable by nation, year and product.' },
];

/** The front page of a self-hosted Open ASL: what it is, and the way in. */
export function Landing() {
  const auth = useAuth();
  return (
    <div className="landing">
      <header className="landing-bar">
        <Link to="/" className="brand">
          <Emblem size={36} />
          <span>
            OPEN <b>ASL</b>
          </span>
        </Link>
        <nav>
          {auth.status === 'member' ? (
            <Link to="/app" className="btn primary">
              Enter the lobby
            </Link>
          ) : (
            <Link to="/login" className="btn">
              Sign in
            </Link>
          )}
        </nav>
      </header>

      <section className="hero">
        <Emblem size={140} />
        <h1>
          OPEN <span>ASL</span>
        </h1>
        <p className="tagline">Advanced Squad Leader in the browser.</p>
        <p className="lede">
          <strong>Every rule enforced by the engine.</strong> Play hotseat or live online.
        </p>
        <div className="hero-cta">
          <Link to={auth.status === 'member' ? '/app' : '/login'} className="btn primary">
            {auth.status === 'member' ? 'Enter the lobby' : 'Sign in to play'}
          </Link>
        </div>
      </section>

      <section className="landing-section wide">
        <h2>Why Open ASL</h2>
        <div className="why-grid">
          {FEATURES.map((card) => (
            <article key={card.title} className="why-card">
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="landing-foot">
        <p className="muted small">
          A free, non-commercial project. Open ASL is not affiliated with or endorsed by Multi-Man Publishing or Hasbro.
          Advanced Squad Leader is a trademark of Hasbro, Inc. used under licence by Multi-Man Publishing.
        </p>
      </footer>
    </div>
  );
}
