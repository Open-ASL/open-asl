import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { emailLead, matchEmail } from '../src/lib/outbox';

const at = Timestamp.fromDate(new Date('2026-11-28T18:00:00Z'));
const base = { nickname: 'Able', scenarioTitle: 'Foy', scheduledAt: at, rulesetId: 'starter-kit' as const };

describe('the withdrawn notice', () => {
  it('tells the host the opponent withdrew and the post is back on the board', () => {
    const mail = matchEmail({ ...base, kind: 'withdrawn', withdrawnBy: 'Baker', reopened: true }, 'https://asl.example');
    expect(emailLead('withdrawn')).toBe('Your opponent withdrew from your match');
    expect(mail.title).toBe('Your opponent withdrew');
    expect(mail.text).toContain('Baker withdrew from your scheduled match: Foy');
    expect(mail.text).toContain('back on the Games board');
    expect(mail.body).not.toContain('approaching');
    expect(mail.action?.href).toBe('https://asl.example/app/starter-kit/games');
  });

  it('tells the opponent the host withdrew and the game is cancelled', () => {
    const mail = matchEmail({ ...base, kind: 'withdrawn', withdrawnBy: 'Charlie', reopened: false });
    expect(mail.text).toContain('Charlie withdrew from your scheduled match');
    expect(mail.text).toContain('The game is cancelled and your booked time is free again.');
    expect(mail.text).not.toContain('Games board');
  });

  it('escapes the nicknames in the HTML', () => {
    const mail = matchEmail({ ...base, nickname: '<b>x</b>', kind: 'withdrawn', withdrawnBy: 'A&B', reopened: true });
    expect(mail.body).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(mail.body).toContain('A&amp;B withdrew');
  });
});
