import { useLang } from '../lang.js';

const PRODUCTS = [
  { name: 'Camiseta Titular', en: 'Home Kit' },
  { name: 'Poster Crest Stencil', en: 'Crest Stencil Poster' },
  { name: 'Peluche Lola la Grúa', en: 'Lola Plush' },
  { name: 'Pin Esmaltado Lola', en: 'Lola Enamel Pin' },
];

export default function Tienda() {
  const { t } = useLang();
  return (
    <section className="section">
      <h1 className="page-title">{t({ es: 'Tienda', en: 'Shop' })}</h1>
      <p className="prose-narrow">
        {t({
          es: 'Pocas piezas, bien hechas, con sentido. Cada camiseta cuenta la historia del sponsor local en letras grandes, no escondido.',
          en: 'Fewer pieces, well made, meaningful. Every kit tells the local sponsor’s story in big letters, not hidden away.',
        })}
      </p>
      <div className="product-grid">
        {PRODUCTS.map((p) => (
          <div className="product-card" key={p.name}>
            <div className="product-swatch" />
            <strong>{t({ es: p.name, en: p.en })}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
