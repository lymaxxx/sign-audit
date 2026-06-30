import { Link } from 'react-router-dom';
import Crest from '../assets/Crest.jsx';
import Lola from '../assets/Lola.jsx';
import { useLang } from '../lang.js';

export default function Home() {
  const { t } = useLang();

  return (
    <div>
      <section className="hero hero-gears">
        <div className="hero-content">
          <Crest size={150} />
          <h1 className="hero-title">{t({ es: 'La voz del puerto', en: 'The voice of the port' })}</h1>
          <p className="hero-tagline">
            {t({
              es: 'Club Atlético de Riachuelo — nacidos en la orilla, desde 1913.',
              en: 'Club Atlético de Riachuelo — born on the riverbank, since 1913.',
            })}
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary" to="/hazte-socio">
              {t({ es: 'Hazte socio', en: 'Become a member' })}
            </Link>
            <Link className="btn btn-ghost" to="/himno">
              {t({ es: 'Escuchá el himno', en: 'Listen to the anthem' })}
            </Link>
          </div>
        </div>
      </section>

      <section className="section three-card-row">
        <Link to="/manifiesto" className="feature-card">
          <h3>{t({ es: 'El Manifiesto', en: 'The Manifesto' })}</h3>
          <p>{t({ es: 'No somos la marca, somos la fe.', en: "We're not the brand, we're the faith." })}</p>
        </Link>
        <Link to="/equipos" className="feature-card">
          <h3>{t({ es: 'Próximo Partido', en: 'Next Match' })}</h3>
          <p>{t({ es: 'Mirá el fixture y los resultados.', en: 'Check the fixtures and results.' })}</p>
        </Link>
        <Link to="/tienda" className="feature-card">
          <h3>{t({ es: 'La Tienda', en: 'The Shop' })}</h3>
          <p>{t({ es: 'Camiseta, posters y merch de Lola.', en: 'Kit, prints, and Lola merch.' })}</p>
        </Link>
      </section>

      <section className="section section-alt lola-strip">
        <Lola size={90} />
        <p className="lola-strip-text">{t({ es: 'Lola vigila la orilla.', en: 'Lola watches over the riverbank.' })}</p>
        <Link to="/lola" className="btn btn-ghost btn-sm">
          {t({ es: 'Conocé a Lola', en: 'Meet Lola' })}
        </Link>
      </section>
    </div>
  );
}
