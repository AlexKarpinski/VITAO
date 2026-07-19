import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHero } from '../components/ui/PageHero';
import { useLanguage } from '../i18n/LanguageContext';

const STORAGE_KEY = 'vitao-custom-request-draft';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

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
    formNote: 'Oficjalny kanał wysyłki nie został jeszcze publicznie potwierdzony. Przygotuj treść zapytania, skopiuj ją i wyślij ręcznie po uzyskaniu potwierdzonego adresu kontaktowego. Wpisane dane są przechowywane na tym urządzeniu maksymalnie przez 24 godziny.',
    submitStatus: 'Zapytanie jest gotowe. Dane pozostają zapisane na tym urządzeniu maksymalnie przez 24 godziny.',
    copySuccess: 'Treść zapytania została skopiowana.',
    copyError: 'Nie udało się skopiować automatycznie. Zaznacz tekst podglądu i skopiuj go ręcznie.',
    clearButton: 'Wyczyść zapisany szkic',
    clearStatus: 'Zapisany szkic został usunięty.',
    previewTitle: 'Podgląd zapytania',
    previewHint: 'Sprawdź treść przed wysłaniem. Formularz nie wysyła danych i nie wskazuje niepotwierdzonego adresu.',
    copyButton: 'Kopiuj zapytanie',
    labels: {
      name: 'Imię', email: 'E-mail', product: 'Produkt lub pomysł', dimensions: 'Wymiary', color: 'Preferowany kolor', quantity: 'Liczba sztuk', city: 'Miasto dostawy', notes: 'Uwagi',
    },
    placeholders: {
      name: 'Twoje imię', email: 'ty@example.com', product: 'Ridge Tray, stojak na kontroler, wkład do szuflady…', dimensions: 'Przybliżone wymiary lub rozmiar przedmiotu…', color: 'Ciepła kość słoniowa, kamienny, grafitowy…', quantity: '1', city: 'Warszawa, Kraków, Gdańsk…', notes: 'Opisz przestrzeń, zastosowanie, termin lub ograniczenia.',
    },
    button: 'Przygotuj zapytanie',
    details: ['Nazwa produktu lub własny pomysł', 'Przybliżone wymiary albo przedmiot, do którego produkt ma pasować', 'Preferowany kolor lub kierunek wykończenia', 'Liczba sztuk i miasto dostawy', 'Informacje o przestrzeni, zastosowaniu, terminie lub ograniczeniach'],
    steps: ['Wybierz produkt do modyfikacji albo opisz przedmiot, półkę, szufladę, biurko lub codzienną czynność, którą chcesz usprawnić.', 'Podaj praktyczne szczegóły: wymiary, preferowany kolor, liczbę sztuk, miasto dostawy i dodatkowe informacje o zastosowaniu.', 'Przygotuj podgląd, skopiuj treść i wyślij ją ręcznie po potwierdzeniu oficjalnego kanału kontaktu.'],
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
    formNote: 'The official inquiry destination has not been publicly confirmed yet. Prepare and copy the request, then send it manually once a verified contact address is available. Entered details are stored on this device for no longer than 24 hours.',
    submitStatus: 'Your inquiry is ready. The entered details remain stored on this device for no longer than 24 hours.',
    copySuccess: 'The inquiry text was copied.',
    copyError: 'Automatic copying failed. Select the preview text and copy it manually.',
    clearButton: 'Clear saved draft',
    clearStatus: 'The saved draft was removed.',
    previewTitle: 'Inquiry preview',
    previewHint: 'Review the text before sending. This form does not transmit data or present an unverified address.',
    copyButton: 'Copy inquiry',
    labels: {
      name: 'Name', email: 'Email', product: 'Product or idea', dimensions: 'Dimensions', color: 'Preferred color', quantity: 'Quantity', city: 'Delivery city', notes: 'Notes',
    },
    placeholders: {
      name: 'Your name', email: 'you@example.com', product: 'Ridge Tray, controller stand, drawer insert…', dimensions: 'Approximate dimensions or object size…', color: 'Warm ivory, stone, graphite…', quantity: '1', city: 'Warsaw, Kraków, Gdańsk…', notes: 'Tell us about the space, use case, timing, or constraints.',
    },
    button: 'Prepare inquiry',
    details: ['Product name or custom idea', 'Approximate dimensions or the item it needs to fit', 'Preferred color or finish direction', 'Quantity and delivery city', 'Notes about the space, use case, timing, or constraints'],
    steps: ['Choose a product to adjust or describe the object, shelf, drawer, desk, or routine you want to improve.', 'Share the practical details: dimensions, preferred color, quantity, delivery city, and notes about use.', 'Prepare the preview, copy the text, and send it manually after the official contact channel is confirmed.'],
  },
};

type Draft = {
  name: string;
  email: string;
  productName: string;
  dimensions: string;
  color: string;
  quantity: string;
  deliveryCity: string;
  notes: string;
};

type StoredDraft = {
  draft: Partial<Record<keyof Draft, unknown>>;
  expiresAt: number;
};

const EMPTY_DRAFT: Draft = {
  name: '',
  email: '',
  productName: '',
  dimensions: '',
  color: '',
  quantity: '1',
  deliveryCity: '',
  notes: '',
};

const DRAFT_FIELDS = Object.keys(EMPTY_DRAFT) as (keyof Draft)[];

function removeStoredDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function hasDraftContent(draft: Draft) {
  return Object.entries(draft).some(([field, value]) => field === 'quantity' ? value !== '1' : value.trim() !== '');
}

function restoreDraft(requestedProduct: string): Draft {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { ...EMPTY_DRAFT, productName: requestedProduct };

    const stored = JSON.parse(saved) as Partial<StoredDraft>;
    if (!stored.draft || typeof stored.expiresAt !== 'number' || stored.expiresAt <= Date.now()) {
      removeStoredDraft();
      return { ...EMPTY_DRAFT, productName: requestedProduct };
    }

    const restored = { ...EMPTY_DRAFT };
    for (const field of DRAFT_FIELDS) {
      const value = stored.draft[field];
      if (typeof value === 'string') restored[field] = value;
    }

    restored.productName = requestedProduct || restored.productName;
    return restored;
  } catch {
    removeStoredDraft();
    return { ...EMPTY_DRAFT, productName: requestedProduct };
  }
}

export function CustomOrder() {
  const [searchParams] = useSearchParams();
  const { language } = useLanguage();
  const text = copy[language];
  const requestedProduct = useMemo(() => searchParams.get('product') ?? '', [searchParams]);
  const [draft, setDraft] = useState<Draft>(() => restoreDraft(requestedProduct));
  const [status, setStatus] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const skipNextDraftWrite = useRef(false);

  useEffect(() => {
    if (skipNextDraftWrite.current) {
      skipNextDraftWrite.current = false;
      removeStoredDraft();
      return;
    }

    if (!hasDraftContent(draft)) {
      removeStoredDraft();
      return;
    }

    try {
      const stored: StoredDraft = { draft, expiresAt: Date.now() + DRAFT_TTL_MS };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Keep the request flow usable when browser storage is unavailable.
    }
  }, [draft]);

  const requestText = useMemo(() => [
    `${text.labels.name}: ${draft.name}`,
    `${text.labels.email}: ${draft.email}`,
    `${text.labels.product}: ${draft.productName}`,
    `${text.labels.dimensions}: ${draft.dimensions}`,
    `${text.labels.color}: ${draft.color}`,
    `${text.labels.quantity}: ${draft.quantity}`,
    `${text.labels.city}: ${draft.deliveryCity}`,
    `${text.labels.notes}: ${draft.notes}`,
  ].join('\n'), [draft, text]);

  function updateField(field: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowPreview(true);
    setStatus(text.submitStatus);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(requestText);
      setStatus(text.copySuccess);
    } catch {
      setStatus(text.copyError);
    }
  }

  function handleClearDraft() {
    skipNextDraftWrite.current = true;
    removeStoredDraft();
    setDraft({ ...EMPTY_DRAFT, productName: requestedProduct });
    setShowPreview(false);
    setStatus(text.clearStatus);
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
          <label>{text.labels.name}<input placeholder={text.placeholders.name} value={draft.name} onChange={(event) => updateField('name', event.target.value)} required /></label>
          <label>{text.labels.email}<input placeholder={text.placeholders.email} type="email" value={draft.email} onChange={(event) => updateField('email', event.target.value)} required /></label>
          <label>{text.labels.product}<input placeholder={text.placeholders.product} value={draft.productName} onChange={(event) => updateField('productName', event.target.value)} required /></label>
          <label>{text.labels.dimensions}<input placeholder={text.placeholders.dimensions} value={draft.dimensions} onChange={(event) => updateField('dimensions', event.target.value)} required /></label>
          <label>{text.labels.color}<input placeholder={text.placeholders.color} value={draft.color} onChange={(event) => updateField('color', event.target.value)} required /></label>
          <label>{text.labels.quantity}<input placeholder={text.placeholders.quantity} inputMode="numeric" value={draft.quantity} onChange={(event) => updateField('quantity', event.target.value)} required /></label>
          <label>{text.labels.city}<input placeholder={text.placeholders.city} value={draft.deliveryCity} onChange={(event) => updateField('deliveryCity', event.target.value)} required /></label>
          <label>{text.labels.notes}<textarea placeholder={text.placeholders.notes} value={draft.notes} onChange={(event) => updateField('notes', event.target.value)} required /></label>
          <button type="submit">{text.button}</button>
          <button type="button" onClick={handleClearDraft}>{text.clearButton}</button>
          {showPreview && (
            <section aria-labelledby="request-preview-title">
              <h2 id="request-preview-title">{text.previewTitle}</h2>
              <p className="form-note">{text.previewHint}</p>
              <textarea aria-label={text.previewTitle} value={requestText} readOnly rows={10} />
              <button type="button" onClick={handleCopy}>{text.copyButton}</button>
            </section>
          )}
          {status && <p className="form-note" role="status">{status}</p>}
        </form>
      </section>
    </>
  );
}
