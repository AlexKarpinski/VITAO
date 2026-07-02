import { products } from '../data/products';
import { ProductCard } from '../components/product/ProductCard';
import { PageHero } from '../components/ui/PageHero';
export function Products() { const categories=[...new Set(products.map(p=>p.category))]; return <><PageHero eyebrow="Catalog" title="Curated objects for everyday spaces.">Browse a small starting collection of made-to-order trays, organizers, stands, and custom-fit pieces.</PageHero><div className="chips">{categories.map(c=><span key={c}>{c}</span>)}</div><section className="product-grid">{products.map((product)=><ProductCard key={product.id} product={product}/>)}</section></>; }
