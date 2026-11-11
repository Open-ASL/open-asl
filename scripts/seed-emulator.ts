/**
 * Seed the local emulators with invited players: `pnpm seed alice@example.com bob@example.com`.
 * Each email is allowlisted and gets a pre-verified password account (password: "password").
 * Run while `pnpm dev` is up.
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.GCLOUD_PROJECT ??= 'demo-asl-web';

const emails = process.argv.slice(2).map((e) => e.trim().toLowerCase());
if (!emails.length) {
  console.error('usage: pnpm seed <email> [email...]');
  process.exit(1);
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = getFirestore();
const auth = getAuth();

for (const email of emails) {
  await db.collection('allowlist').doc(email).set({ invitedBy: 'seed', invitedAt: FieldValue.serverTimestamp(), claimedBy: null, claimedAt: null }, { merge: true });
  try {
    await auth.getUserByEmail(email);
    console.log(`${email}: allowlisted (account exists)`);
  } catch {
    await auth.createUser({ email, password: 'password', emailVerified: true, displayName: email.split('@')[0] });
    console.log(`${email}: allowlisted, account created (password: password)`);
  }
}
