/**
 * The banner over a commentator's board, big enough to read on a stream: whether the audience is watching the game as
 * it stands (LIVE), an earlier moment of it (REWOUND, or REPLAY once it has ended), or a position the commentators
 * have made up (VIRTUAL). The board pane's frame takes the same colour.
 */
export function SsBanner({ status, live, where, behind }: { status: 'live' | 'rewound' | 'virtual'; live: boolean; where: string; behind: number }) {
  if (status === 'virtual')
    return (
      <div className="ss-banner virtual" role="status">
        <b>VIRTUAL BOARD · NOT LIVE</b>
        <span>
          {where}
          {behind > 0 ? ` · the game is ${behind} action${behind === 1 ? '' : 's'} on` : ''}
        </span>
      </div>
    );
  if (status === 'rewound')
    return (
      <div className="ss-banner rewound" role="status">
        <b>{live ? 'REWOUND · NOT LIVE' : 'REPLAY'}</b>
        <span>{where}</span>
      </div>
    );
  return (
    <div className={`ss-banner ${live ? 'live' : 'final'}`} role="status">
      <b>{live ? <><i className="ss-dot" />LIVE</> : 'FINAL POSITION'}</b>
      <span>{where}</span>
    </div>
  );
}
