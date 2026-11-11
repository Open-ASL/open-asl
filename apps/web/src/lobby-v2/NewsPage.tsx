import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { newsDate, useAnnouncements, VideoEmbed } from './news';

/** Every published announcement in full: hero image or video, summary, and the dispatch body. */
export function NewsPage() {
  const news = useAnnouncements(40);
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash || !news.length) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash, news.length]);
  return <main className="page-frame news-page">
    {news.length ? <div className="news-feed">{news.map((row) => {
      const { id, data } = row;
      return <article key={id} id={id} className={`news-article ${data.imageURL ? 'has-image' : ''}`}>
        {data.imageURL && <img src={data.imageURL} alt="" />}
        {data.videoURL && <VideoEmbed url={data.videoURL} title={data.title} />}
        <div>
          <p className="news-meta">{data.pinned && <span className="news-pin">Pinned</span>}<time>{newsDate(row)}</time></p>
          <h2>{data.title}</h2>
          <p className="news-summary">{data.summary}</p>
          {data.body && <p className="news-body">{data.body}</p>}
        </div>
      </article>;
    })}</div> : <p className="empty-state">Field reports and announcements will appear here.</p>}
  </main>;
}
