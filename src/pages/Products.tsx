import { categories, products } from '../data/products';
import { ProductCard } from '../components/product/ProductCard';
import { SectionLabel } from '../components/ui/SectionLabel';

export function Products() {
  return <section className="page"><SectionLabel>Catalog</SectionLabel><h1>Curated objects for calmer surfaces.</h1><p className="lede">Browse a small collection of desk, home, beauty, gaming, and custom-ready pieces.</p><div className="chips">{categories.map((category) => <span key={category}>{category}</span>)}</div><div className="product-grid">{products.map((product) => <ProductCard key={product.slug} product={product} />)}</div></section>;
}
