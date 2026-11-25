import { useEffect } from 'react';
import { useParams } from 'react-router';
import { useControlsBridge } from './bridge';
import { SsControls } from './SsControls';

/** /app/match/:id/ss/controls — a commentator's controls in a window of their own, linked to the board window. */
export function SsControlsWindow() {
  const { id = '' } = useParams<{ id: string }>();
  const { state, send } = useControlsBridge(id);
  useEffect(() => {
    document.title = 'Commentary controls · Open ASL';
  }, []);
  if (!state)
    return (
      <div className="ss-window">
        <div className="ss-waiting">
          <h1>Commentary controls</h1>
          <p>Waiting for the commentator's board of this match. Keep it open in another window of this browser.</p>
        </div>
      </div>
    );
  return (
    <div className="ss-window">
      <SsControls state={state} send={send} docked={false} />
    </div>
  );
}
