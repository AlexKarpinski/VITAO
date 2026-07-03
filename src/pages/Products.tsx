import { products } from '../data/products';
import { ProductCard } from '../components/product/ProductCard';
import { PageHero } from '../components/ui/PageHero';

export function Products() {
  const categories = [...new Set(products.map((product) => product.category))];

  return (
    <>
      <PageHero eyebrow="Catalog" title="Curated objects for everyday spaces.">
        Browse a focused collection of made-to-order trays, organizers, stands, and custom-fit pieces with simple starting prices.
      </PageHero>
      <div className="chips">{categories.map((category) => <span key={category}>{category}</span>)}</div>
      <section className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} />)}</section>
    </>
  );
}
