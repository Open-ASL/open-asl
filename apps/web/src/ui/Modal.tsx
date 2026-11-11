import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: string;
  onClose?(): void;
  children: ReactNode;
  /** A short label above the title. */
  kicker?: string;
  /** A wider dialog, for side-by-side content. */
  wide?: boolean;
}

/** A centred dialog over whatever is on screen; Escape and the backdrop close it when allowed. */
export function Modal({ title, kicker, onClose, children, wide }: Props) {
  useEffect(() => {
    if (!onClose) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return createPortal(
    <div className="set-backdrop" onClick={onClose}>
      <div className={`set-panel modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="set-head">
          <div>
            {kicker && <span className="kicker">{kicker}</span>}
            <h2 className="modal-title">{title}</h2>
          </div>
          {onClose && (
            <button className="ghost" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
