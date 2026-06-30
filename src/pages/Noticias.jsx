import { useLang } from '../lang.js';

const NEWS = [
  { tag: 'Club', es: 'Asamblea de socios fija fecha para julio', en: 'Members’ assembly sets date for July' },
  { tag: 'Equipos', es: 'Primer equipo gana en la última fecha', en: 'First team wins in latest matchday' },
  { tag: 'Hinchada', es: 'Nueva tanda de carnets "Del Puerto"', en: 'New batch of "Del Puerto" member cards' },
];

export default function Noticias() {
  const { t } = useLang();
  return (
    <section className="section">
      <h1 className="page-title">{t({ es: 'Noticias', en: 'News' })}</h1>
      <div className="news-grid">
        {NEWS.map((n) => (
          <div className="news-card" key={n.es}>
            <span className="news-tag">{n.tag}</span>
            <h3>{t({ es: n.es, en: n.en })}</h3>
          </div>
        ))}
      </div>
    </section>
  );
}
