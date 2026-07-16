import { ProductCard } from '../components/product/ProductCard';
import { PageHero } from '../components/ui/PageHero';
import { products } from '../data/products';
import { useLanguage } from '../i18n/LanguageContext';

const polishProductCopy: Record<string, { category: string; summary: string; imageAlt: string }> = {
  'ridge-tray': {
    category: 'Biurko i praca',
    summary: 'Niska tacka na drobne przedmioty, które gromadzą się na biurku lub przy wejściu.',
    imageAlt: 'Tacka Ridge Tray z zegarkiem, kluczami, długopisem i drobną biżuterią na ciepłym, neutralnym tle.',
  },
  'flow-pen-cup': {
    category: 'Biurko i praca',
    summary: 'Rzeźbiarski kubek na długopisy o miękkim profilu, który porządkuje spokojną przestrzeń pracy.',
    imageAlt: 'Żłobkowany kubek Flow Pen Cup z długopisami i nożyczkami w minimalistycznej aranżacji biurka.',
  },
  'modular-desk-organizer': {
    category: 'Biurko i praca',
    summary: 'Wielokomorowy organizer na przybory, notatki, przewody i drobne narzędzia biurkowe.',
    imageAlt: 'Modular Desk Organizer z uporządkowanymi przyborami i drobnymi akcesoriami biurkowymi.',
  },
  'dune-cosmetic-organizer': {
    category: 'Kosmetyki i toaletka',
    summary: 'Dopracowany organizer na kosmetyki, próbki i codzienne akcesoria pielęgnacyjne.',
    imageAlt: 'Dune Cosmetic Organizer z kosmetykami i pędzlem na neutralnej powierzchni toaletki.',
  },
  'arc-controller-stand': {
    category: 'Gaming i ekspozycja',
    summary: 'Minimalistyczny stojak do eksponowania kontrolerów, konsol przenośnych i małych urządzeń.',
    imageAlt: 'Arc Controller Stand z kontrolerem w ciepłej, minimalistycznej aranżacji stanowiska.',
  },
  'elevate-headset-stand': {
    category: 'Gaming i ekspozycja',
    summary: 'Stabilny stojak, który pozwala estetycznie przechowywać słuchawki pomiędzy sesjami.',
    imageAlt: 'Elevate Headset Stand ze słuchawkami na spokojnej, neutralnej powierzchni biurka.',
  },
  'wave-catch-all-dish': {
    category: 'Organizacja domu',
    summary: 'Tacka o miękkich krawędziach na biżuterię, monety, drobiazgi nocne i codzienne rytuały.',
    imageAlt: 'Wave Catch-All Dish z biżuterią i kluczami na ciepłej powierzchni przy łóżku.',
  },
  'custom-fit-object': {
    category: 'Projekty indywidualne',
    summary: 'Przedmiot wykonywany na zamówienie i projektowany do konkretnej rzeczy, półki, stanowiska lub rytuału.',
    imageAlt: 'Neutralny detal studyjny przedstawiający koncepcję indywidualnego przedmiotu VITAO.',
  },
};

export function Products() {
  const { language } = useLanguage();
  const localizedProducts = language === 'pl'
    ? products.map((product) => ({ ...product, ...polishProductCopy[product.id] }))
    : products;
  const categories = [...new Set(localizedProducts.map((product) => product.category))];
  const copy = language === 'pl'
    ? {
        eyebrow: 'Katalog',
        title: 'Wybrane przedmioty do codziennych przestrzeni.',
        description: 'Poznaj dopracowaną kolekcję wykonywanych na zamówienie tacek, organizerów, stojaków i elementów dopasowanych do konkretnej potrzeby.',
      }
    : {
        eyebrow: 'Catalog',
        title: 'Curated objects for everyday spaces.',
        description: 'Browse a focused collection of made-to-order trays, organizers, stands, and custom-fit pieces with simple starting prices.',
      };

  return (
    <>
      <PageHero eyebrow={copy.eyebrow} title={copy.title}>
        {copy.description}
      </PageHero>
      <div className="chips">{categories.map((category) => <span key={category}>{category}</span>)}</div>
      <section className="product-grid">{localizedProducts.map((product) => <ProductCard key={product.id} product={product} />)}</section>
    </>
  );
}
