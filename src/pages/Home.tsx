import { featuredProducts } from '../data/products';
import { ProductCard } from '../components/product/ProductCard';
import { Button } from '../components/ui/Button';
import { CTASection } from '../components/sections/CTASection';

export function Home() {
  return <>
    <section className="hero"><div><p className="eyebrow">Small studio objects</p><h1>Custom printed objects for modern spaces.</h1><p>Functional, minimal pieces for desks, homes, vanity corners, gaming setups, and quiet everyday rituals.</p><div className="actions"><Button to="/products">Browse products</Button><Button to="/custom" variant="secondary">Start custom order</Button></div></div><div className="hero-card"><span>Warm matte finishes</span><strong>Designed to organize beautifully.</strong></div></section>
    <section className="section"><p className="eyebrow">Featured pieces</p><h2>Refined essentials, made to order.</h2><div className="product-grid">{featuredProducts.map((product)=><ProductCard key={product.id} product={product}/>)}</div></section>
    <section className="feature-grid"><article><p className="eyebrow">Materials</p><h3>Matte, tactile, quiet.</h3><p>Warm neutral colors, refined edges, and sturdy forms selected for everyday use.</p></article><article><p className="eyebrow">Process</p><h3>Simple request flow.</h3><p>Pick a piece, ask for a tweak, or share measurements for a custom object.</p></article><article><p className="eyebrow">Purpose</p><h3>Useful over decorative noise.</h3><p>Every piece is designed to make a real surface calmer and easier to use.</p></article></section>
    <CTASection />
  </>;
}
