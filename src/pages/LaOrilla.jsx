import { useLang } from '../lang.js';

export default function LaOrilla() {
  const { t } = useLang();
  return (
    <section className="section section-chapa">
      <h1 className="page-title">{t({ es: 'La Orilla', en: 'The Riverbank' })}</h1>
      <div className="prose">
        <p>
          {t({
            es: 'El Riachuelo no es solo un nombre: es el agua marrón que corre detrás de cada conventillo de chapa, el puerto que dio trabajo a los abuelos genoveses, la niebla que cubre las grúas al amanecer. Este club nació de esa orilla, y nunca se mudó de ella.',
            en: 'The Riachuelo isn’t just a name: it’s the brown water running behind every tin-roofed conventillo, the port that gave Genoese grandparents their work, the fog that covers the cranes at dawn. This club was born on that riverbank, and never left it.',
          })}
        </p>
        <p>
          {t({
            es: 'Chapa, remaches, madera de embalaje: los materiales del barrio son los materiales del escudo. Cada textura del club cuenta la misma historia de manos que construyen.',
            en: 'Corrugated tin, rivets, packing-crate wood: the materials of the neighbourhood are the materials of the crest. Every texture in the club tells the same story of hands that build.',
          })}
        </p>
      </div>
      <div className="orilla-grid">
        <div className="orilla-block">{t({ es: 'El puerto', en: 'The port' })}</div>
        <div className="orilla-block">{t({ es: 'Los conventillos', en: 'The conventillos' })}</div>
        <div className="orilla-block">{t({ es: 'Las familias genovesas', en: 'The Genoese families' })}</div>
        <div className="orilla-block">{t({ es: 'El río marrón', en: 'The brown river' })}</div>
      </div>
    </section>
  );
}
