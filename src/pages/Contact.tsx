import { PageHero } from '../components/ui/PageHero';
import { CTASection } from '../components/sections/CTASection';
import { useLanguage } from '../i18n/LanguageContext';

const copy = {
  pl: {
    eyebrow: 'Kontakt i FAQ',
    title: 'Zapytaj o produkt lub rozpocznij projekt na zamówienie.',
    intro: 'VITAO działa w Gdańsku i Trójmieście oraz realizuje dostawy na terenie Polski. Oficjalny kanał kontaktu zostanie opublikowany po jego potwierdzeniu.',
    locationLabel: 'Lokalizacja',
    location: 'Gdańsk / Trójmiasto, Polska',
    deliveryLabel: 'Dostawa',
    delivery: 'Na terenie całej Polski',
    responseLabel: 'Czas odpowiedzi',
    response: 'Zwykle 1–2 dni robocze',
    faq: 'Najczęstsze pytania',
    items: [
      ['Czy sprzedajecie gotowe produkty?', 'Kolekcja MVP pokazuje ceny początkowe i produkty wykonywane na zamówienie zamiast checkoutu. Każde zapytanie jest najpierw potwierdzane indywidualnie.'],
      ['Czy mogę zamówić niestandardowy rozmiar?', 'Tak. Podaj wymiary, przedmiot, do którego produkt ma pasować, oraz miejsce jego użycia. Zakres i cena są potwierdzane przed produkcją.'],
      ['Jak potwierdzane są ceny?', 'Strony produktów pokazują ceny początkowe. Cena końcowa zależy od rozmiaru, wykończenia i personalizacji oraz jest potwierdzana przed rozpoczęciem pracy.'],
      ['Czy na stronie można zapłacić?', 'Nie. To statyczne MVP służy do rozpoczęcia rozmowy przed ewentualnym dodaniem checkoutu lub płatności.'],
      ['Jak wygląda realizacja?', 'Przed rozpoczęciem pracy ręcznie potwierdzamy zakres, materiał, szczegóły produkcji i końcową wycenę.'],
    ],
  },
  en: {
    eyebrow: 'Contact + FAQ',
    title: 'Ask about a piece or start a custom request.',
    intro: 'VITAO is based in Gdańsk and the Trójmiasto area and delivers across Poland. The official contact channel will be published after it is confirmed.',
    locationLabel: 'Location',
    location: 'Gdańsk / Trójmiasto, Poland',
    deliveryLabel: 'Delivery',
    delivery: 'Across Poland',
    responseLabel: 'Response time',
    response: 'Usually 1–2 business days',
    faq: 'Frequently asked questions',
    items: [
      ['Do you sell ready-made products?', 'The MVP collection uses starting prices and made-to-order requests rather than checkout. Each inquiry is confirmed individually first.'],
      ['Can I request a custom size?', 'Yes. Share the measurements, the object it needs to fit, and where the piece will be used. Scope and pricing are confirmed before production.'],
      ['How are prices confirmed?', 'Product pages show starting prices. Final pricing depends on size, finish, and customization and is confirmed before work begins.'],
      ['Are there payments on the site?', 'No. This static MVP is designed to start conversations before checkout or payment tools are considered.'],
      ['How does production work?', 'Before work starts, we manually confirm the scope, material, production details, and final quote.'],
    ],
  },
};

export function Contact() {
  const { language } = useLanguage();
  const text = copy[language];

  return (
    <>
      <PageHero eyebrow={text.eyebrow} title={text.title}>{text.intro}</PageHero>
      <section className="contact-cards" aria-label={text.eyebrow}>
        <div><strong>{text.locationLabel}</strong><span>{text.location}</span></div>
        <div><strong>{text.deliveryLabel}</strong><span>{text.delivery}</span></div>
        <div><strong>{text.responseLabel}</strong><span>{text.response}</span></div>
      </section>
      <section className="section">
        <p className="eyebrow">FAQ</p>
        <h2>{text.faq}</h2>
        {text.items.map(([question, answer]) => <article className="faq" key={question}><h3>{question}</h3><p>{answer}</p></article>)}
      </section>
      <CTASection />
    </>
  );
}
