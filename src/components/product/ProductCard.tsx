import { Link } from 'react-router-dom';
import type { Product } from '../../types/product';

export function ProductCard({ product }: { product: Product }) {
  return (
    <article className="product-card">
      <Link className="product-card__visual" to={`/products/${product.slug}`} aria-label={`View ${product.name}`}>
        <span>{product.category}</span>
      </Link>
      <div className="product-card__body">
        <p className="eyebrow">{product.category}</p>
        <h3>{product.name}</h3>
        <p>{product.summary}</p>
        <div className="product-card__footer"><strong>{product.price}</strong><Link to={`/products/${product.slug}`}>View piece</Link></div>
      </div>
    </article>
  );
}
