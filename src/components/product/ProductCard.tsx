import { Link } from 'react-router-dom';
import { useLanguage } from '../../i18n/LanguageContext';
import type { Product } from '../../types/product';

export function ProductCard({ product }: { product: Product }) {
  const { language } = useLanguage();
  const requestPath = `/custom?product=${encodeURIComponent(product.name)}`;
  const copy = language === 'pl'
    ? {
        viewAria: `Zobacz produkt ${product.name}`,
        view: 'Zobacz produkt',
        ask: 'Zapytaj o ten produkt',
      }
    : {
        viewAria: `View ${product.name}`,
        view: 'View piece',
        ask: 'Ask about this piece',
      };

  return (
    <article className="product-card">
      <Link className="product-card__visual" to={`/products/${product.slug}`} aria-label={copy.viewAria}>
        <img src={product.image} alt={product.imageAlt} loading="lazy" />
      </Link>
      <div className="product-card__body">
        <p className="eyebrow">{product.category}</p>
        <h3>{product.name}</h3>
        <p>{product.summary}</p>
        <div className="product-card__footer"><strong>{product.price}</strong><Link to={`/products/${product.slug}`}>{copy.view}</Link></div>
        <Link className="product-card__request" to={requestPath}>{copy.ask}</Link>
      </div>
    </article>
  );
}
