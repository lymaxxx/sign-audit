import { useLang } from '../lang.js';

export default function Bombonera() {
  const { t } = useLang();
  return (
    <section className="section">
      <h1 className="page-title">{t({ es: 'La Bombonera del Río', en: 'La Bombonera del Río' })}</h1>
      <p className="prose-narrow">
        {t({
          es: 'A metros del Riachuelo, el estadio se llena cada domingo con el bombo, la murga y la tribuna que nunca se sienta.',
          en: 'Steps from the Riachuelo, the stadium fills every Sunday with the drum, the murga, and a terrace that never sits down.',
        })}
      </p>
      <div className="info-cards">
        <div className="info-card">
          <h3>{t({ es: 'Puertas', en: 'Gates' })}</h3>
          <p>{t({ es: 'Abren 2 horas antes del partido.', en: 'Open 2 hours before kickoff.' })}</p>
        </div>
        <div className="info-card">
          <h3>{t({ es: 'Cómo llegar', en: 'Getting there' })}</h3>
          <p>{t({ es: 'A pie desde la estación del puerto.', en: 'Walking distance from the port station.' })}</p>
        </div>
        <div className="info-card">
          <h3>{t({ es: 'Accesibilidad', en: 'Accessibility' })}</h3>
          <p>{t({ es: 'Plataforma adaptada en tribuna norte.', en: 'Adapted platform in the north stand.' })}</p>
        </div>
      </div>
      <div className="map-placeholder">{t({ es: 'Mapa del estadio', en: 'Stadium map' })}</div>
    </section>
  );
}
