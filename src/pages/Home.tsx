import { ProductCard } from '../components/product/ProductCard';
import { CTASection } from '../components/sections/CTASection';
import { Button } from '../components/ui/Button';
import { featuredProducts } from '../data/products';
import { useLanguage } from '../i18n/LanguageContext';

const heroImage = `${import.meta.env.BASE_URL}images/products/hero-collection.jpg`;

const content = {
  pl: {
    heroEyebrow: 'Przedmioty z małej pracowni',
    heroTitle: 'Przedmioty na zamówienie do spokojnych, nowoczesnych wnętrz.',
    heroBody: 'Funkcjonalne przedmioty w ciepłym, minimalistycznym stylu — na biurko, do domu, toaletki, stanowiska gamingowego i codziennych rytuałów.',
    browseAction: 'Zobacz kolekcję',
    customAction: 'Rozpocznij zamówienie indywidualne',
    heroAlt: 'Wybrane przedmioty VITAO ułożone na ciepłej powierzchni biurka w pracowni.',
    heroCaption: 'Ciepłe, matowe wykończenia',
    heroCaptionStrong: 'Piękny porządek na co dzień.',
    featuredEyebrow: 'Polecane produkty',
    featuredTitle: 'Dopracowane przedmioty wykonywane na zamówienie.',
    materialsEyebrow: 'Materiały',
    materialsTitle: 'Matowe, przyjemne w dotyku, spokojne.',
    materialsBody: 'Ciepłe neutralne kolory, dopracowane krawędzie i solidne formy dobrane do codziennego użytkowania.',
    processEyebrow: 'Proces',
    processTitle: 'Prosty sposób składania zapytania.',
    processBody: 'Wybierz produkt, poproś o drobną zmianę lub prześlij wymiary przedmiotu wykonywanego indywidualnie.',
    purposeEyebrow: 'Cel',
    purposeTitle: 'Funkcja zamiast dekoracyjnego chaosu.',
    purposeBody: 'Każdy przedmiot powstaje po to, aby konkretna przestrzeń była spokojniejsza, bardziej uporządkowana i wygodniejsza.',
  },
  en: {
    heroEyebrow: 'Small studio objects',
    heroTitle: 'Custom objects for calm, modern spaces.',
    heroBody: 'Functional, warm-minimal pieces for desks, homes, vanity corners, gaming setups, and the small rituals that shape everyday life.',
    browseAction: 'Browse the collection',
    customAction: 'Start a custom request',
    heroAlt: 'Curated VITAO collection arranged on a warm desk-studio surface.',
    heroCaption: 'Warm matte finishes',
    heroCaptionStrong: 'Made to organize beautifully.',
    featuredEyebrow: 'Featured pieces',
    featuredTitle: 'Refined essentials, made to order.',
    materialsEyebrow: 'Materials',
    materialsTitle: 'Matte, tactile, quiet.',
    materialsBody: 'Warm neutral colors, refined edges, and sturdy forms selected for daily use.',
    processEyebrow: 'Process',
    processTitle: 'A simple request flow.',
    processBody: 'Choose a piece, ask for a small adjustment, or share measurements for a custom object.',
    purposeEyebrow: 'Purpose',
    purposeTitle: 'Useful over decorative noise.',
    purposeBody: 'Every piece is shaped to make a real surface calmer, clearer, and easier to use.',
  },
};

export function Home() {
  const { language } = useLanguage();
  const copy = content[language];

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">{copy.heroEyebrow}</p>
          <h1>{copy.heroTitle}</h1>
          <p>{copy.heroBody}</p>
          <div className="actions">
            <Button to="/products">{copy.browseAction}</Button>
            <Button to="/custom" variant="secondary">{copy.customAction}</Button>
          </div>
        </div>
        <figure className="hero-card">
          <img src={heroImage} alt={copy.heroAlt} />
          <figcaption>
            <span>{copy.heroCaption}</span>
            <strong>{copy.heroCaptionStrong}</strong>
          </figcaption>
        </figure>
      </section>
      <section className="section">
        <p className="eyebrow">{copy.featuredEyebrow}</p>
        <h2>{copy.featuredTitle}</h2>
        <div className="product-grid">{featuredProducts.map((product) => <ProductCard key={product.id} product={product} />)}</div>
      </section>
      <section className="feature-grid">
        <article>
          <p className="eyebrow">{copy.materialsEyebrow}</p>
          <h3>{copy.materialsTitle}</h3>
          <p>{copy.materialsBody}</p>
        </article>
        <article>
          <p className="eyebrow">{copy.processEyebrow}</p>
          <h3>{copy.processTitle}</h3>
          <p>{copy.processBody}</p>
        </article>
        <article>
          <p className="eyebrow">{copy.purposeEyebrow}</p>
          <h3>{copy.purposeTitle}</h3>
          <p>{copy.purposeBody}</p>
        </article>
      </section>
      <CTASection />
    </>
  );
}
