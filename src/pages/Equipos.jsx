import { useLang } from '../lang.js';

const SQUAD = [
  { name: 'M. Fagioli', pos: 'GK', num: 1 },
  { name: 'D. Crespo', pos: 'DEF', num: 4 },
  { name: 'L. Ferraro', pos: 'DEF', num: 5 },
  { name: 'S. Bianchi', pos: 'MID', num: 8 },
  { name: 'R. Olmos', pos: 'MID', num: 10 },
  { name: 'G. Vitale', pos: 'FWD', num: 9 },
];

const FIXTURES = [
  { date: 'Sáb 04 Jul', opp: 'Atlético del Puerto', venue: 'Local', live: true },
  { date: 'Sáb 11 Jul', opp: 'Unión Genovesa', venue: 'Visitante', live: false },
  { date: 'Sáb 18 Jul', opp: 'Defensores de la Boca', venue: 'Local', live: false },
];

export default function Equipos() {
  const { t } = useLang();
  return (
    <section className="section">
      <h1 className="page-title">{t({ es: 'Equipos', en: 'Teams' })}</h1>

      <h2 className="section-subtitle">{t({ es: 'Primer Equipo', en: 'First Team' })}</h2>
      <div className="squad-grid">
        {SQUAD.map((p) => (
          <div className="squad-card" key={p.num}>
            <span className="squad-num">{p.num}</span>
            <strong>{p.name}</strong>
            <span>{p.pos}</span>
          </div>
        ))}
      </div>

      <h2 className="section-subtitle">{t({ es: 'Cantera', en: 'Academy' })}</h2>
      <p className="prose-narrow">
        {t({
          es: 'Desde sub-9 hasta reserva, la cantera de Riachuelo forma jugadores con la misma fe que la hinchada: del barrio, para el barrio.',
          en: 'From U9 to reserves, Riachuelo’s academy builds players with the same faith as the supporters: from the neighbourhood, for the neighbourhood.',
        })}
      </p>

      <h2 className="section-subtitle">{t({ es: 'Fixtures & Resultados', en: 'Fixtures & Results' })}</h2>
      <table className="fixtures-table">
        <thead>
          <tr>
            <th>{t({ es: 'Fecha', en: 'Date' })}</th>
            <th>{t({ es: 'Rival', en: 'Opponent' })}</th>
            <th>{t({ es: 'Sede', en: 'Venue' })}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {FIXTURES.map((f) => (
            <tr key={f.opp}>
              <td>{f.date}</td>
              <td>{f.opp}</td>
              <td>{f.venue}</td>
              <td>{f.live && <span className="live-dot" title={t({ es: 'En vivo', en: 'Live' })} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
