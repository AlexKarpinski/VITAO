import { FormEvent, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHero } from '../components/ui/PageHero';
import { useLanguage } from '../i18n/LanguageContext';

const copy = {
  pl: {
    eyebrow: 'Projekt na zamówienie',
    title: 'Zapytaj o produkt dopasowany do Twojej przestrzeni.',
    intro: 'Opisz produkt lub własny pomysł, aby przygotować zakres i wycenę. Szczegóły oraz cena są zawsze potwierdzane przed rozpoczęciem produkcji.',
    flow: 'Przebieg zapytania',
    include: 'Co warto uwzględnić',
    explanation: 'Dokładny opis pomaga nam zrozumieć przedmiot, przestrzeń i oczekiwane wykończenie bez dodawania checkoutu ani automatycznej sprzedaży do tego MVP.',
    detailsLabel: 'Przydatne informacje do zapytania',
    responseLabel: 'Czas odpowiedzi.',
    response: 'Zwykle odpowiadamy w ciągu 1–2 dni roboczych.',
    how: 'Jak to działa',
    formNote: 'Kanał wysyłki zapytań nie został jeszcze publicznie potwierdzony. Formularz pozwala przygotować komplet informacji, ale nie wysyła danych.',
    submitStatus: 'Zapytanie zostało przygotowane lokalnie. Wysyłka będzie dostępna po potwierdzeniu oficjalnego kanału kontaktu.',
    labels: {
      name: 'Imię', email: 'E-mail', product: 'Produkt lub pomysł', dimensions: 'Wymiary', color: 'Preferowany kolor', quantity: 'Liczba sztuk', city: 'Miasto dostawy', notes: 'Uwagi',
    },
    placeholders: {
      name: 'Twoje imię', email: 'ty@example.com', product: 'Ridge Tray, stojak na kontroler, wkład do szuflady…', dimensions: 'Przybliżone wymiary lub rozmiar przedmiotu…', color: 'Ciepła kość słoniowa, kamienny, grafitowy…', quantity: '1', city: 'Warszawa, Kraków, Gdańsk…', notes: 'Opisz przestrzeń, zastosowanie, termin lub ograniczenia.',
    },
    button: 'Przygotuj zapytanie',
    details: ['Nazwa produktu lub własny pomysł', 'Przybliżone wymiary albo przedmiot, do którego produkt ma pasować', 'Preferowany kolor lub kierunek wykończenia', 'Liczba sztuk i miasto dostawy', 'Informacje o przestrzeni, zastosowaniu, terminie lub ograniczeniach'],
    steps: ['Wybierz produkt do modyfikacji albo opisz przedmiot, półkę, szufladę, biurko lub codzienną czynność, którą chcesz usprawnić.', 'Podaj praktyczne szczegóły: wymiary, preferowany kolor, liczbę sztuk, miasto dostawy i dodatkowe informacje o zastosowaniu.', 'Po uruchomieniu oficjalnego kanału kontaktu odpowiemy z pytaniami, sugestiami materiału i wykończenia oraz wstępną wyceną przed produkcją.'],
  },
  en: {
    eyebrow: 'Custom request',
    title: 'Ask for a piece made around your space.',
    intro: 'Describe a product or custom idea so the scope and quote can be prepared. Details and pricing are always confirmed before production begins.',
    flow: 'Request flow',
    include: 'What to include',
    explanation: 'A thoughtful request helps us understand the object, space, and finish without adding checkout or automated sales to this MVP.',
    detailsLabel: 'Useful request details',
    responseLabel: 'Response time.',
    response: 'We usually reply within 1–2 business days.',
    how: 'How it works',
    formNote: 'The public inquiry destination has not been confirmed yet. This form prepares the required details but does not send data.',
    submitStatus: 'The inquiry was prepared locally. Sending will be enabled after the official contact channel is confirmed.',
    labels: {
      name: 'Name', email: 'Email', product: 'Product or idea', dimensions: 'Dimensions', color: 'Preferred color', quantity: 'Quantity', city: 'Delivery city', notes: 'Notes',
    },
    placeholders: {
      name: 'Your name', email: 'you@example.com', product: 'Ridge Tray, controller stand, drawer insert…', dimensions: 'Approximate dimensions or object size…', color: 'Warm ivory, stone, graphite…', quantity: '1', city: 'Warsaw, Kraków, Gdańsk…', notes: 'Tell us about the space, use case, timing, or constraints.',
    },
    button: 'Prepare inquiry',
    details: ['Product name or custom idea', 'Approximate dimensions or the item it needs to fit', 'Preferred color or finish direction', 'Quantity and delivery city', 'Notes about the space, use case, timing, or constraints'],
    steps: ['Choose a product to adjust or describe the object, shelf, drawer, desk, or routine you want to improve.', 'Share the practical details: dimensions, preferred color, quantity, delivery city, and notes about use.', 'Once the official contact channel is active, we will reply with questions, material and finish suggestions, and a starting quote before production.'],
  },
};

export function CustomOrder() {
  const [searchParams] = useSearchParams();
  const { language } = useLanguage();
  const text = copy[language];
  const requestedProduct = useMemo(() => searchParams.get('product') ?? '', [searchParams]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [productName, setProductName] = useState(requestedProduct);
  const [dimensions, setDimensions] = useState('');
  const [color, setColor] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(text.submitStatus);
  }

  return (
    <>
      <PageHero eyebrow={text.eyebrow} title={text.title}>{text.intro}</PageHero>
      <section className="split split--top">
        <div>
          <p className="eyebrow">{text.flow}</p>
          <h2>{text.include}</h2>
          <p>{text.explanation}</p>
          <div className="request-list" aria-label={text.detailsLabel}>
            {text.details.map((detail) => <p key={detail}>{detail}</p>)}
          </div>
          <p className="response-note"><strong>{text.responseLabel}</strong> {text.response}</p>
          <h2>{text.how}</h2>
          {text.steps.map((step, index) => <p className="step" key={step}><strong>{index + 1}</strong>{step}</p>)}
        </div>
        <form className="form" onSubmit={handleSubmit}>
          <p className="form-note">{text.formNote}</p>
          <label>{text.labels.name}<input placeholder={text.placeholders.name} value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label>{text.labels.email}<input placeholder={text.placeholders.email} type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>{text.labels.product}<input placeholder={text.placeholders.product} value={productName} onChange={(event) => setProductName(event.target.value)} required /></label>
          <label>{text.labels.dimensions}<input placeholder={text.placeholders.dimensions} value={dimensions} onChange={(event) => setDimensions(event.target.value)} required /></label>
          <label>{text.labels.color}<input placeholder={text.placeholders.color} value={color} onChange={(event) => setColor(event.target.value)} required /></label>
          <label>{text.labels.quantity}<input placeholder={text.placeholders.quantity} inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
          <label>{text.labels.city}<input placeholder={text.placeholders.city} value={deliveryCity} onChange={(event) => setDeliveryCity(event.target.value)} required /></label>
          <label>{text.labels.notes}<textarea placeholder={text.placeholders.notes} value={notes} onChange={(event) => setNotes(event.target.value)} required /></label>
          <button type="submit">{text.button}</button>
          {status && <p className="form-note" role="status">{status}</p>}
        </form>
      </section>
    </>
  );
}
