import { useLang } from '../lang.js';

const TIERS = [
  {
    name: 'De la Orilla',
    nameEn: 'Of the Riverbank',
    es: ['Carnet de socio', 'Acceso a la tribuna popular', 'Descuento en la tienda'],
    en: ['Member card', 'Standing terrace access', 'Shop discount'],
  },
  {
    name: 'Del Puerto',
    nameEn: 'Of the Port',
    es: ['Todo lo de "De la Orilla"', 'Asiento numerado', 'Newsletter exclusiva'],
    en: ['Everything in "Of the Riverbank"', 'Numbered seat', 'Exclusive newsletter'],
  },
  {
    name: 'Vitalicio',
    nameEn: 'Lifetime',
    es: ['Membresía de por vida', 'Nombre en el muro de socios', 'Invitación a asambleas'],
    en: ['Lifetime membership', 'Name on the members’ wall', 'Invitation to assemblies'],
  },
];

export default function HazteSocio() {
  const { t } = useLang();
  return (
    <section className="section">
      <h1 className="page-title">{t({ es: 'Hazte Socio', en: 'Become a Member' })}</h1>
      <p className="prose-narrow">
        {t({
          es: 'Ser socio de Riachuelo no es suscribirse a un servicio: es entrar a una mutual. Tu cuota se queda en el barrio, no en un balance global.',
          en: 'Being a Riachuelo member isn’t subscribing to a service: it’s joining a mutual aid society. Your dues stay in the neighbourhood, not on a global balance sheet.',
        })}
      </p>
      <div className="tiers-grid">
        {TIERS.map((tier) => (
          <div className="tier-card" key={tier.name}>
            <h3>{t({ es: tier.name, en: tier.nameEn })}</h3>
            <ul>
              {(t({ es: tier.es, en: tier.en }) || []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <button type="button" className="btn btn-primary btn-sm">
              {t({ es: 'Sumarme', en: 'Join' })}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
