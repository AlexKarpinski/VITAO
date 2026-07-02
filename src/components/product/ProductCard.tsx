import type { Product } from '../../types/product';

export function ProductCard({ product }: { product: Product; key?: string }) {
  return (
    <article className="product-card">
      <a className="product-card__visual" href={`#/products/${product.slug}`} aria-label={`View ${product.name}`}>
        <span>{product.category}</span>
      </a>
      <div className="product-card__body">
        <div>
          <p className="eyebrow">{product.category}</p>
          <h3>{product.name}</h3>
        </div>
        <p>{product.summary}</p>
        <div className="product-card__meta"><strong>{product.price}</strong><a href={`#/products/${product.slug}`}>View piece</a></div>
      </div>
    </article>
  );
}
