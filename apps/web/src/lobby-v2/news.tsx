import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { COL, type AnnouncementDoc } from '@asl/platform';
import { db } from '../firebase';
import { toDate } from '../ui/time';

export interface NewsRow {
  id: string;
  data: AnnouncementDoc;
}

/** The latest published announcements, newest first; pinned ones are hoisted to the top. */
export function useAnnouncements(max: number): NewsRow[] {
  const [news, setNews] = useState<NewsRow[]>([]);
  useEffect(() => onSnapshot(
    query(collection(db, COL.announcements), where('status', '==', 'published'), orderBy('publishAt', 'desc'), limit(max)),
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, data: d.data() as AnnouncementDoc }));
      setNews([...rows.filter((r) => r.data.pinned), ...rows.filter((r) => !r.data.pinned)]);
    },
    () => setNews([]),
  ), [max]);
  return news;
}

export function newsDate(row: NewsRow): string {
  return toDate(row.data.publishAt)?.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) ?? '';
}

export function VideoEmbed({ url, title }: { url: string; title: string }) {
  let src = '';
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu')) {
      const id = parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1) : parsed.searchParams.get('v');
      if (id) src = `https://www.youtube-nocookie.com/embed/${id}`;
    } else if (parsed.hostname.includes('vimeo')) src = `https://player.vimeo.com/video/${parsed.pathname.split('/').filter(Boolean).at(-1)}`;
  } catch { return null; }
  return src ? <iframe src={src} title={title} loading="lazy" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen /> : null;
}
