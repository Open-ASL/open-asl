import { useRef, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { COL } from '@asl/platform';
import { db, errorOf, storage } from '../firebase';

/** Upload a profile picture (png/jpeg/webp under 2 MB), or go back to the Gravatar. */
export function AvatarUpload({ uid, hasPhoto }: { uid: string; hasPhoto: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setError('PNG, JPEG or WebP only.');
    if (file.size >= 2 * 1024 * 1024) return setError('Keep it under 2 MB.');
    setBusy(true);
    setError(null);
    try {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const r = ref(storage, `avatars/${uid}/avatar.${ext}`);
      await uploadBytes(r, file, { contentType: file.type });
      const url = await getDownloadURL(r);
      await updateDoc(doc(db, COL.users, uid), { photoURL: `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`, updatedAt: serverTimestamp() });
    } catch (e) {
      setError(errorOf(e).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const useGravatar = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateDoc(doc(db, COL.users, uid), { photoURL: null, updatedAt: serverTimestamp() });
    } catch (e) {
      setError(errorOf(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="avatar-upload">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <div className="buttons">
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Uploading…' : 'Upload a picture'}
        </button>
        {hasPhoto && (
          <button type="button" className="ghost" disabled={busy} onClick={() => void useGravatar()}>
            Use Gravatar
          </button>
        )}
      </div>
      {error && <p className="warn small">{error}</p>}
      <p className="muted small">No picture? Your Gravatar for this email is shown.</p>
    </div>
  );
}
