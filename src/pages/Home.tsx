import { featuredProducts } from '../data/products';
import { ProductCard } from '../components/product/ProductCard';
import { Button } from '../components/ui/Button';
import { CTASection } from '../components/sections/CTASection';

const heroImage = `${import.meta.env.BASE_URL}images/products/hero-collection.jpg`;

export function Home() {
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Small studio objects</p>
          <h1>Custom objects for calm, modern spaces.</h1>
          <p>
            Functional, warm-minimal pieces for desks, homes, vanity corners, gaming setups, and the small rituals that shape everyday life.
          </p>
          <div className="actions">
            <Button to="/products">Browse the collection</Button>
            <Button to="/custom" variant="secondary">Start a custom request</Button>
          </div>
        </div>
        <figure className="hero-card">
          <img src={heroImage} alt="Curated VITAO collection arranged on a warm desk-studio surface." />
          <figcaption>
            <span>Warm matte finishes</span>
            <strong>Made to organize beautifully.</strong>
          </figcaption>
        </figure>
      </section>
      <section className="section">
        <p className="eyebrow">Featured pieces</p>
        <h2>Refined essentials, made to order.</h2>
        <div className="product-grid">{featuredProducts.map((product) => <ProductCard key={product.id} product={product} />)}</div>
      </section>
      <section className="feature-grid">
        <article>
          <p className="eyebrow">Materials</p>
          <h3>Matte, tactile, quiet.</h3>
          <p>Warm neutral colors, refined edges, and sturdy forms selected for daily use.</p>
        </article>
        <article>
          <p className="eyebrow">Process</p>
          <h3>A simple request flow.</h3>
          <p>Choose a piece, ask for a small adjustment, or share measurements for a custom object.</p>
        </article>
        <article>
          <p className="eyebrow">Purpose</p>
          <h3>Useful over decorative noise.</h3>
          <p>Every piece is shaped to make a real surface calmer, clearer, and easier to use.</p>
        </article>
      </section>
      <CTASection />
    </>
  );
}
