import { getProductBySlug, products } from '../data/products';
import { ProductCard } from '../components/product/ProductCard';
import { Button } from '../components/ui/Button';
import { SectionLabel } from '../components/ui/SectionLabel';

export function ProductDetail({ slug }: { slug: string }) {
  const product = getProductBySlug(slug) ?? products[0];
  const related = products.filter((item) => item.category === product.category && item.slug !== product.slug).slice(0, 3);
  return <><section className="detail"><div className="detail__gallery"><div>{product.name}</div><div>{product.category}</div></div><div className="detail__content"><SectionLabel>{product.category}</SectionLabel><h1>{product.name}</h1><p className="lede">{product.description}</p><strong className="price">{product.price}</strong><dl><dt>Dimensions</dt><dd>{product.dimensions}</dd><dt>Materials</dt><dd>{product.materials.join(', ')}</dd><dt>Colors</dt><dd>{product.colors.join(', ')}</dd></dl><div className="hero__actions"><Button href="#/custom">Request this piece</Button><Button href="#/custom" variant="secondary">Customize this piece</Button></div></div></section>{related.length > 0 && <section className="section"><SectionLabel>Related</SectionLabel><div className="product-grid">{related.map((item) => <ProductCard key={item.slug} product={item} />)}</div></section>}</>;
}
