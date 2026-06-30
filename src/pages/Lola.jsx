import { Link } from 'react-router-dom';
import LolaArt from '../assets/Lola.jsx';
import { useLang } from '../lang.js';

export default function Lola() {
  const { t } = useLang();
  return (
    <section className="section lola-page">
      <div className="lola-hero">
        <LolaArt size={220} />
        <div>
          <h1 className="page-title">Lola la Grúa</h1>
          <p className="prose-narrow">
            {t({
              es: 'Lola vigila la orilla desde lo alto de las grúas del puerto — mitad garza, mitad grúa, siempre del lado de la hinchada.',
              en: 'Lola watches over the riverbank from atop the port cranes — half heron, half crane, always on the supporters’ side.',
            })}
          </p>
        </div>
      </div>

      <h2 className="section-subtitle">{t({ es: 'Origen', en: 'Origin' })}</h2>
      <div className="prose">
        <p>
          {t({
            es: 'Las garzas siempre caminaron la orilla del Riachuelo, pacientes, con el cuello largo atento al agua. Las grúas del puerto hacían lo mismo con el río de carga: brazos largos, atentos, siempre trabajando. Lola nació de unir las dos — el ave y la máquina — en un solo guardián.',
            en: 'Herons always walked the Riachuelo riverbank, patient, long necks watching the water. The port cranes did the same with the cargo river: long arms, watchful, always working. Lola was born from joining the two — the bird and the machine — into a single guardian.',
          })}
        </p>
        <p>
          {t({
            es: 'Su pico es un gancho de grúa. Sus patas, vigas de andamio. Su ojo, la única luz verde permitida en todo el escudo — la señal de que el puerto sigue despierto.',
            en: 'Her beak is a crane hook. Her legs, scaffolding beams. Her eye, the only green light allowed anywhere on the crest — the signal that the port is still awake.',
          })}
        </p>
      </div>

      <h2 className="section-subtitle">{t({ es: 'Zona de diversión', en: 'Fun zone' })}</h2>
      <div className="fun-grid">
        <div className="fun-card">{t({ es: 'Descargá la lámina para colorear', en: 'Download the colouring sheet' })}</div>
        <div className="fun-card">{t({ es: 'Stickers de Lola', en: 'Lola sticker pack' })}</div>
        <div className="fun-card">{t({ es: '"Lola dice…" — tips de cada partido', en: '"Lola says…" — matchday tips' })}</div>
      </div>

      <Link to="/tienda" className="btn btn-primary">
        {t({ es: 'Ver peluche y pin de Lola', en: 'See Lola plush & pin' })}
      </Link>
    </section>
  );
}
