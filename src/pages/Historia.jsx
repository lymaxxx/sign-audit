import { useLang } from '../lang.js';

export default function Historia() {
  const { t } = useLang();
  return (
    <section className="section">
      <h1 className="page-title">{t({ es: 'Historia', en: 'Our Story' })}</h1>
      <div className="prose duotone-bg">
        <p>
          {t({
            es: 'Club Atlético de Riachuelo nació en 1913 en La Boca, entre los talleres, los muelles y los conventillos de chapa donde se mezclaban estibadores criollos y familias genovesas recién llegadas. No fue un club de salón: fue una voz que se levantó desde el trabajo del puerto.',
            en: 'Club Atlético de Riachuelo was born in 1913 in La Boca, among the workshops, docks, and tin-roofed conventillos where Creole dockworkers and newly arrived Genoese families mixed. It wasn’t a parlour club: it was a voice that rose from the labour of the port.',
          })}
        </p>
        <p>
          {t({
            es: 'A lo largo de las décadas, el club se definió en contraste con la comercialización creciente de su vecino histórico, Boca Juniors. Mientras la marca crecía, Riachuelo eligió quedarse chico, fiel y de la gente — un club que se gana, no se compra.',
            en: 'Over the decades, the club defined itself against the growing commercialization of its historic neighbour, Boca Juniors. While the brand grew, Riachuelo chose to stay small, loyal, and of the people — a club that’s earned, not bought.',
          })}
        </p>
      </div>
      <ul className="timeline">
        <li>
          <span className="timeline-year">1913</span>
          {t({
            es: 'Fundación por estibadores y familias genovesas de La Boca.',
            en: 'Founded by dockworkers and Genoese families of La Boca.',
          })}
        </li>
        <li>
          <span className="timeline-year">1928</span>
          {t({ es: 'Primer título de la liga local del puerto.', en: 'First local port league title.' })}
        </li>
        <li>
          <span className="timeline-year">1957</span>
          {t({
            es: 'Inauguración de La Bombonera del Río, a metros del Riachuelo.',
            en: 'La Bombonera del Río opens, steps from the Riachuelo.',
          })}
        </li>
        <li>
          <span className="timeline-year">{t({ es: 'Hoy', en: 'Today' })}</span>
          {t({
            es: 'Un club de socios, no de accionistas — la hinchada sigue siendo la dueña.',
            en: 'A club of members, not shareholders — the supporters still own it.',
          })}
        </li>
      </ul>
    </section>
  );
}
