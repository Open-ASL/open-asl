import { useState, type FormEvent } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { COL } from '@asl/platform';
import { db, errorOf } from '../firebase';

/** Change your own display name (2–32 characters; the rules enforce the same). */
export function EditName({ uid, name, onDone }: { uid: string; name: string; onDone(): void }) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (v.length < 2 || v.length > 32) return setError('2 to 32 characters.');
    setBusy(true);
    try {
      await updateDoc(doc(db, COL.users, uid), { displayName: v, updatedAt: serverTimestamp() });
      onDone();
    } catch (err) {
      setError(errorOf(err).message);
      setBusy(false);
    }
  };
  return (
    <form className="edit-name" onSubmit={submit}>
      <input autoFocus maxLength={32} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Display name" />
      <button className="primary" disabled={busy}>
        Save
      </button>
      <button type="button" className="ghost" onClick={onDone}>
        Cancel
      </button>
      {error && <p className="warn small">{error}</p>}
    </form>
  );
}
