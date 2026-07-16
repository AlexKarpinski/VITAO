import { Link, useParams } from 'react-router-dom';
import { findProductBySlug, products } from '../data/products';
import { ProductCard } from '../components/product/ProductCard';
import { Button } from '../components/ui/Button';
import { useLanguage } from '../i18n/LanguageContext';

const polishProductCopy: Record<string, {
  category: string;
  description: string;
  dimensions: string;
  colors: string[];
  materials: string[];
  imageAlt: string;
}> = {
  'ridge-tray': {
    category: 'Biurko i praca',
    description: 'Ridge Tray porządkuje klucze, słuchawki, karty i drobne przedmioty w jednym spokojnym miejscu. Delikatnie ryflowana podstawa dodaje faktury bez wizualnego chaosu, a matowe wykończenie zachowuje elegancki charakter.',
    dimensions: '18 × 10 × 2 cm',
    colors: ['Ciepła kość słoniowa', 'Kamienny', 'Grafitowy'],
    materials: ['Matowe PLA', 'Ręcznie wykończone krawędzie'],
    imageAlt: 'Ridge Tray z zegarkiem, kluczami, długopisem i drobną biżuterią na ciepłej, neutralnej powierzchni.',
  },
  'flow-pen-cup': {
    category: 'Biurko i praca',
    description: 'Flow Pen Cup utrzymuje długopisy, pędzle i małe narzędzia w pionie, nie tworząc wrażenia biurowego bałaganu. Zaokrąglona forma nadaje codziennej organizacji spokojny, studyjny charakter.',
    dimensions: '8 × 8 × 10 cm',
    colors: ['Kość słoniowa', 'Oliwkowy', 'Taupe'],
    materials: ['Matowe PLA'],
    imageAlt: 'Ryflowany Flow Pen Cup z długopisami i nożyczkami na minimalistycznym biurku.',
  },
  'modular-desk-organizer': {
    category: 'Biurko i praca',
    description: 'Modular Desk Organizer tworzy przemyślane miejsce na luźne elementy stanowiska pracy. Układ przegródek można dopasować do artykułów papierniczych, drobnej elektroniki lub narzędzi do codziennego planowania.',
    dimensions: '24 × 16 × 5 cm',
    colors: ['Ciepła kość słoniowa', 'Kamienny', 'Oliwkowy'],
    materials: ['Matowe PLA', 'Układ przegródek wykonywany na zamówienie'],
    imageAlt: 'Wielokomorowy Modular Desk Organizer z artykułami papierniczymi i drobnymi akcesoriami biurkowymi.',
  },
  'dune-cosmetic-organizer': {
    category: 'Kosmetyki i toaletka',
    description: 'Dune Cosmetic Organizer wykorzystuje stopniowane przegródki, dzięki którym butelki, pędzle i małe akcesoria są dobrze widoczne i łatwe do ułożenia. Forma pasuje do narożników toaletki i półek łazienkowych wymagających porządku bez ciężkości.',
    dimensions: '22 × 12 × 5 cm',
    colors: ['Piaskowy', 'Ciepła kość słoniowa', 'Gliniany'],
    materials: ['Matowe PLA', 'Możliwość dopasowania rozmiaru'],
    imageAlt: 'Dune Cosmetic Organizer z butelkami kosmetyków i pędzlem na neutralnej powierzchni toaletki.',
  },
  'arc-controller-stand': {
    category: 'Gaming i ekspozycja',
    description: 'Arc Controller Stand nadaje akcesoriom gamingowym przemyślane miejsce, gdy nie są używane. Stabilna, kompaktowa podpora dobrze wygląda na półce, biurku lub konsoli multimedialnej.',
    dimensions: '12 × 10 × 8 cm',
    colors: ['Grafitowy', 'Kamienny', 'Oliwkowy'],
    materials: ['Matowe PLA', 'Opcjonalna filcowa podstawa'],
    imageAlt: 'Arc Controller Stand z kontrolerem w ciepłej, minimalistycznej aranżacji.',
  },
  'elevate-headset-stand': {
    category: 'Gaming i ekspozycja',
    description: 'Elevate Headset Stand porządkuje stanowisko gamingowe lub robocze bez dodawania wizualnego ciężaru. Szeroka podstawa i miękka pionowa forma utrzymują słuchawki w zasięgu ręki.',
    dimensions: '18 × 14 × 25 cm',
    colors: ['Grafitowy', 'Kamienny', 'Ciepła kość słoniowa'],
    materials: ['Matowe PLA', 'Opcjonalna filcowa podstawa'],
    imageAlt: 'Elevate Headset Stand ze słuchawkami na spokojnej, neutralnej powierzchni biurka.',
  },
  'wave-catch-all-dish': {
    category: 'Organizacja domu',
    description: 'Wave Catch-All Dish tworzy małe miejsce na przedmioty, po które sięgasz każdego dnia. Łagodna krawędź i płytka forma sprawdzają się na stoliku nocnym, półce lub przy wejściu.',
    dimensions: '14 × 14 × 3 cm',
    colors: ['Kość słoniowa', 'Piaskowy', 'Gliniany'],
    materials: ['Matowe PLA'],
    imageAlt: 'Wave Catch-All Dish z biżuterią i kluczami na ciepłej powierzchni przy łóżku.',
  },
  'custom-fit-object': {
    category: 'Projekty na zamówienie',
    description: 'Prześlij informacje o przedmiocie, wymiary i opis przestrzeni, którą chcesz ulepszyć. VITAO przygotuje praktyczną, dopracowaną formę dopasowaną do zastosowania i potwierdzi wycenę przed rozpoczęciem produkcji.',
    dimensions: 'Dopasowane do potrzeb',
    colors: ['Ciepłe neutralne', 'Grafitowy', 'Wybrane kolory niestandardowe'],
    materials: ['Materiał dobierany do zastosowania'],
    imageAlt: 'Koncepcja Custom Fit Object jako neutralny detal studyjny dla produktu VITAO wykonywanego na zamówienie.',
  },
};

export function ProductDetail() {
  const { slug } = useParams();
  const { language } = useLanguage();
  const product = findProductBySlug(slug);

  if (!product) {
    return language === 'pl'
      ? <section className="page-hero"><h1>Nie znaleziono produktu</h1><p>Ten produkt mógł zostać przeniesiony.</p><Link to="/products">Wróć do produktów</Link></section>
      : <section className="page-hero"><h1>Piece not found</h1><p>This product may have moved.</p><Link to="/products">Back to products</Link></section>;
  }

  const localized = language === 'pl' ? polishProductCopy[product.id] : undefined;
  const related = products.filter((item) => item.category === product.category && item.id !== product.id).slice(0, 3);
  const gallery = product.gallery?.length ? product.gallery : [product.image];
  const requestPath = `/custom?product=${encodeURIComponent(product.name)}`;
  const category = localized?.category ?? product.category;
  const description = localized?.description ?? product.description;
  const dimensions = localized?.dimensions ?? product.dimensions;
  const colors = localized?.colors ?? product.colors;
  const materials = localized?.materials ?? product.materials;
  const imageAlt = localized?.imageAlt ?? product.imageAlt;

  return (
    <>
      <section className="detail">
        <div className="detail__gallery" aria-label={language === 'pl' ? `Galeria produktu ${product.name}` : `${product.name} image gallery`}>
          <img className="detail__image" src={product.image} alt={imageAlt} />
          {gallery.length > 1 && (
            <div className="detail__thumbs">
              {gallery.map((image) => <img key={image} src={image} alt="" aria-hidden="true" />)}
            </div>
          )}
        </div>
        <div>
          <p className="eyebrow">{category}</p>
          <h1>{product.name}</h1>
          <p className="lead">{description}</p>
          <h2>{product.price}</h2>
          <div className="meta">
            <p><strong>{language === 'pl' ? 'Wymiary' : 'Dimensions'}</strong>{dimensions}</p>
            <p><strong>{language === 'pl' ? 'Kolory' : 'Colors'}</strong>{colors.join(', ')}</p>
            <p><strong>{language === 'pl' ? 'Materiały' : 'Materials'}</strong>{materials.join(', ')}</p>
          </div>
          <div className="actions">
            <Button to={requestPath}>{language === 'pl' ? 'Zapytaj o ten produkt' : 'Ask about this piece'}</Button>
            <Button to={requestPath} variant="secondary">{language === 'pl' ? 'Dostosuj produkt' : 'Customise it'}</Button>
          </div>
          <p className="response-note">{language === 'pl' ? 'Zwykle odpowiadamy w ciągu 1–2 dni roboczych.' : 'We usually reply within 1–2 business days.'}</p>
        </div>
      </section>
      {related.length > 0 && (
        <section className="section">
          <p className="eyebrow">{language === 'pl' ? 'Podobne' : 'Related'}</p>
          <h2>{language === 'pl' ? 'Podobne produkty' : 'Similar pieces'}</h2>
          <div className="product-grid">{related.map((item) => <ProductCard key={item.id} product={item} />)}</div>
        </section>
      )}
    </>
  );
}
