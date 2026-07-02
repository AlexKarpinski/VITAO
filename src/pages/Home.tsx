import { featuredProducts } from '../data/products';
import { ProductCard } from '../components/product/ProductCard';
import { Button } from '../components/ui/Button';
import { SectionLabel } from '../components/ui/SectionLabel';
import { CTASection } from '../components/sections/CTASection';

export function Home() {
  return <>
    <section className="hero"><div><SectionLabel>Small studio objects</SectionLabel><h1>Custom printed objects for modern spaces.</h1><p>VITAO creates functional, refined pieces for desks, homes, vanity routines, and considered setups.</p><div className="hero__actions"><Button href="#/products">Browse products</Button><Button href="#/custom" variant="secondary">Start a custom order</Button></div></div><div className="hero__visual"><span>Ridge Tray / Stone Matte</span></div></section>
    <section className="section"><SectionLabel>Featured pieces</SectionLabel><div className="section__heading"><h2>Useful forms, quietly refined.</h2><p>Start from a curated object or ask for dimensions made around your space.</p></div><div className="product-grid">{featuredProducts.map((product) => <ProductCard key={product.slug} product={product} />)}</div></section>
    <section className="feature-grid"><article><h3>Made to order</h3><p>Objects are produced in small batches with room for color, size, and use-case adjustments.</p></article><article><h3>Warm minimal finish</h3><p>Matte surfaces, calm colors, and simple silhouettes keep the focus on everyday usefulness.</p></article><article><h3>Conversation first</h3><p>No checkout pressure. The MVP is built around requests, questions, and custom fit.</p></article></section>
    <CTASection />
  </>;
}
