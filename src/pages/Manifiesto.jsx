import { useLang } from '../lang.js';

export default function Manifiesto() {
  const { t } = useLang();
  return (
    <section className="manifiesto">
      <p className="manifiesto-line">
        {t({ es: 'No somos la marca,', en: "We're not the brand," })}
        <br />
        <span className="manifiesto-highlight">{t({ es: 'somos la fe.', en: "we're the faith." })}</span>
      </p>
      <div className="manifiesto-body">
        <p>
          {t({
            es: 'No vendemos el escudo. No tercerizamos el aguante. No hay logo global que valga más que un socio que paga su cuota un domingo de lluvia.',
            en: 'We don’t sell the crest. We don’t outsource our loyalty. No global logo is worth more than a member paying their dues on a rainy Sunday.',
          })}
        </p>
        <p>
          {t({
            es: 'Riachuelo existe porque alguien decidió que el fútbol del barrio no estaba en venta. Esa decisión se repite cada año, cada cuota, cada cántico.',
            en: 'Riachuelo exists because someone decided the neighbourhood’s football wasn’t for sale. That decision repeats every year, every due, every chant.',
          })}
        </p>
      </div>
    </section>
  );
}
