import { useEffect, useState, type FormEvent } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { COL, type AnnouncementDoc } from '@asl/platform';
import { useMember } from '../auth/AuthProvider';
import { api, db, errorOf, storage } from '../firebase';
import { toDate } from '../ui/time';

const localValue = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function AdminAnnouncements() {
  const { user } = useMember();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Array<{ id: string; data: AnnouncementDoc }>>([]);
  const [editing, setEditing] = useState<{ id?: string; data?: AnnouncementDoc } | null>(null);
  useEffect(() => { void user.getIdTokenResult().then((token) => setAdmin(token.claims.admin === true)); }, [user]);
  useEffect(() => {
    if (!admin) return;
    return onSnapshot(
      query(collection(db, COL.announcements), orderBy('publishAt', 'desc')),
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, data: d.data() as AnnouncementDoc }))),
    );
  }, [admin]);
  if (admin === null) return <main className="page-frame"><p>Checking clearance…</p></main>;
  if (!admin) return <main className="page-frame"><h1>Restricted</h1><p className="warn">Administrator access required.</p></main>;
  return <main className="page-frame admin-news"><header className="page-heading"><div><p className="eyebrow">Communications</p><h1>Announcements</h1><p>Draft, schedule, pin, and publish Lobby news.</p></div><button className="btn primary" onClick={() => setEditing({})}>New announcement</button></header><div className="admin-news-list">{rows.map(({ id, data }) => <article key={id}><div><span className={`status-${data.status}`}>{data.status}{data.pinned ? ' · pinned' : ''}</span><h2>{data.title}</h2><p>{data.summary}</p><small>{toDate(data.publishAt)?.toLocaleString()}</small></div><button className="btn" onClick={() => setEditing({ id, data })}>Edit</button></article>)}</div>{editing && <AnnouncementEditor value={editing} onClose={() => setEditing(null)} />}</main>;
}

function AnnouncementEditor({ value, onClose }: { value: { id?: string; data?: AnnouncementDoc }; onClose(): void }) {
  const [title, setTitle] = useState(value.data?.title ?? '');
  const [summary, setSummary] = useState(value.data?.summary ?? '');
  const [body, setBody] = useState(value.data?.body ?? '');
  const [imageURL, setImageURL] = useState(value.data?.imageURL ?? '');
  const [videoURL, setVideoURL] = useState(value.data?.videoURL ?? '');
  const [status, setStatus] = useState<AnnouncementDoc['status']>(value.data?.status ?? 'draft');
  const [pinned, setPinned] = useState(value.data?.pinned ?? false);
  const [publishAt, setPublishAt] = useState(localValue(toDate(value.data?.publishAt) ?? new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File) => {
    setBusy(true); setError(null);
    try { const target = ref(storage, `announcements/${crypto.randomUUID()}-${file.name.replace(/[^A-Za-z0-9._-]/g, '')}`); await uploadBytes(target, file, { contentType: file.type }); setImageURL(await getDownloadURL(target)); }
    catch (e) { setError(errorOf(e).message); } finally { setBusy(false); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { await api('saveAnnouncement', { id: value.id, title, summary, body, imageURL: imageURL || null, videoURL: videoURL || null, status, pinned, publishAt: new Date(publishAt).toISOString() }); onClose(); }
    catch (e) { setError(errorOf(e).message); setBusy(false); }
  };
  return <div className="profile-editor-backdrop"><form className="profile-editor announcement-editor" onSubmit={save}><p className="eyebrow">News desk</p><h2>{value.id ? 'Edit announcement' : 'New announcement'}</h2><label>Title<input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>Summary<textarea required maxLength={300} rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} /></label><label>Body<textarea required maxLength={20000} rows={9} value={body} onChange={(e) => setBody(e.target.value)} /><small>Plain text with paragraph breaks; HTML is never rendered.</small></label><label>Hero image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }} />{imageURL && <img src={imageURL} alt="Preview" />}</label><label>YouTube or Vimeo URL<input value={videoURL} onChange={(e) => setVideoURL(e.target.value)} /></label><div className="two-fields"><label>Status<select value={status} onChange={(e) => setStatus(e.target.value as AnnouncementDoc['status'])}><option value="draft">Draft</option><option value="scheduled">Scheduled</option><option value="published">Published</option><option value="archived">Archived</option></select></label><label>Publication time<input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} /></label></div><label className="check-row"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to top</label>{error && <p className="warn">{error}</p>}<div><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save</button></div></form></div>;
}
