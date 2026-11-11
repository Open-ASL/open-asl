import { Modal } from '../ui/Modal';

interface Props {
  onClose(): void;
}

type Row = [keys: string[], what: string];

const KEYS: Row[] = [
  [['?'], 'This list'],
  [['P'], 'Pass a Defensive First Fire opportunity'],
  [['T'], 'Hold to hide the counters and see the terrain'],
  [['M'], 'Hold to take the markers off the counters (Motion, CE, fire, Smoke…) and read the counters underneath'],
  [['L'], 'Dice log: the last rolls'],
  [['B'], 'Mission briefing'],
  [['C'], 'Charts: IFT, Close Combat, To Hit, terrain, sequence of play'],
  [['['], 'Turn the map a quarter turn counterclockwise'],
  [[']'], 'Turn the map a quarter turn clockwise'],
  [['Q', 'E'], 'Moving vehicle: turn the hull a hexspine counterclockwise / clockwise (1 MP each; free after a Motion attempt)'],
  [['A', 'D'], 'Moving vehicle: point the turret a hexspine counterclockwise / clockwise (free)'],
  [['S'], 'Moving vehicle, stopped: Delay 1 MP (the side panel takes any number)'],
  [['Esc'], 'Back up a level on the action wheel, or close it; close any dialog'],
];

const MOUSE: Row[] = [
  [['Right-click'], 'Open the action wheel: every order lives there'],
  [['Click'], 'Select your stack, or pick a target or destination hex; a moving vehicle turns its hull toward a neighbouring hex it cannot enter'],
  [['Shift', 'Click'], 'Add a stack to the selection (fire groups)'],
  [['Ctrl', 'Click'], 'Ping a hex: a pulse in your colour, with a chime, that your opponent sees too (⌘ on a Mac)'],
  [['Drag'], 'Pan the map; in setup, carry a counter to a hex'],
  [['Scroll'], 'Zoom the map around the pointer'],
];

/** The keyboard and mouse controls, on one card. Opened with ? or the top-bar button. */
export function ShortcutsDialog({ onClose }: Props) {
  const table = (rows: Row[]) => (
    <table className="keys">
      <tbody>
        {rows.map(([keys, what]) => (
          <tr key={what}>
            <th scope="row">
              {keys.map((k, i) => (
                <span key={k}>
                  {i > 0 && <span className="plus">+</span>}
                  <kbd>{k}</kbd>
                </span>
              ))}
            </th>
            <td>{what}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <Modal title="Controls" kicker="Shortcuts" onClose={onClose}>
      <section>
        <h3>Keyboard</h3>
        {table(KEYS)}
      </section>
      <section>
        <h3>Mouse</h3>
        {table(MOUSE)}
      </section>
      <p className="hint">End phase, Confirm setup and Pass also sit in the top bar when they apply.</p>
    </Modal>
  );
}
