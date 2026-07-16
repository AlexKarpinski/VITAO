import type { Language } from '../i18n/LanguageContext';

export type InfoPageSection = {
  title: string;
  body: string[];
};

export type InfoPage = {
  slug: 'order-info' | 'privacy' | 'terms';
  eyebrow: string;
  title: string;
  intro: string;
  updatedLabel: string;
  sections: InfoPageSection[];
};

type LocalizedInfoPage = Record<Language, Omit<InfoPage, 'slug'>> & { slug: InfoPage['slug'] };

const localizedInfoPages: LocalizedInfoPage[] = [
  {
    slug: 'order-info',
    pl: {
      eyebrow: 'Informacje o zamówieniu',
      title: 'Jak zapytać o produkt, otrzymać wycenę i potwierdzić realizację.',
      intro:
        'VITAO działa obecnie jako prosty MVP oparty na bezpośrednim kontakcie. Ceny katalogowe są cenami początkowymi, a szczegóły każdego zamówienia są potwierdzane przed rozpoczęciem produkcji.',
      updatedLabel: 'Zaktualizowano na potrzeby wersji MVP',
      sections: [
        {
          title: 'Zapytanie o produkt',
          body: [
            'Podaj nazwę produktu lub opisz własny pomysł, przybliżone wymiary, preferowany kolor, liczbę sztuk, miasto dostawy oraz dodatkowe wymagania.',
            'Zdjęcia, szkice i wymiary referencyjne pomagają ocenić organizery, stojaki, wkłady do szuflad i elementy dopasowane do istniejących przedmiotów.',
          ],
        },
        {
          title: 'Wycena i potwierdzenie',
          body: [
            'Ceny katalogowe są punktami wyjścia. Ostateczna cena zależy od rozmiaru, wykończenia, liczby sztuk i zakresu personalizacji.',
            'Cena, przewidywany termin i ograniczenia techniczne są potwierdzane przed rozpoczęciem produkcji. Strona MVP nie zawiera koszyka ani automatycznych płatności.',
          ],
        },
        {
          title: 'Termin realizacji',
          body: [
            'Termin jest ustalany indywidualnie wraz z wyceną i może zależeć od koniecznych zmian projektu lub wybranego wykończenia.',
            'W przypadku konkretnej daty podaj ją już w pierwszym zapytaniu, aby można było wcześniej ocenić możliwość realizacji.',
          ],
        },
        {
          title: 'Dostawa',
          body: [
            'Dostawa jest dostępna na terenie Polski. Koszt i sposób wysyłki są potwierdzane indywidualnie zależnie od miejsca docelowego, rozmiaru paczki i bezpiecznego pakowania.',
            'Miasto dostawy pomaga przygotować realistyczną odpowiedź już na etapie pierwszej wyceny.',
          ],
        },
        {
          title: 'Zmiany i problemy z realizacją',
          body: [
            'Zmiany dotyczące produktu należy zgłosić przed potwierdzeniem produkcji, szczególnie w przypadku elementów wykonywanych na wymiar.',
            'Jeżeli produkt dotrze uszkodzony lub będzie wyraźnie różnił się od potwierdzonych ustaleń, zgłoś problem wraz ze zdjęciami, aby można było go rzetelnie rozpatrzyć.',
          ],
        },
      ],
    },
    en: {
      eyebrow: 'Order information',
      title: 'How to request a piece, receive a quote, and confirm production.',
      intro:
        'VITAO currently operates as a conversation-first MVP. Catalog prices are starting points, and every order is confirmed before production begins.',
      updatedLabel: 'Updated for the MVP release',
      sections: [
        {
          title: 'Requesting a piece',
          body: [
            'Share the product name or custom idea, approximate dimensions, preferred color, quantity, delivery city, and any additional requirements.',
            'Photos, sketches, and reference measurements help assess organizers, stands, drawer inserts, and pieces fitted to existing objects.',
          ],
        },
        {
          title: 'Quote and confirmation',
          body: [
            'Catalog prices are starting points. Final pricing depends on size, finish, quantity, and the amount of customization required.',
            'Price, expected timing, and technical limitations are confirmed before production. The MVP website does not include a cart or automatic payments.',
          ],
        },
        {
          title: 'Production timing',
          body: [
            'Timing is agreed individually with the quote and may depend on design adjustments or the selected finish.',
            'Include any required date in the first request so feasibility can be assessed early.',
          ],
        },
        {
          title: 'Delivery',
          body: [
            'Delivery is available across Poland. Cost and shipping method are confirmed individually based on destination, parcel size, and safe packaging.',
            'Providing the delivery city helps make the first quote more realistic.',
          ],
        },
        {
          title: 'Changes and delivery issues',
          body: [
            'Product changes should be shared before production is confirmed, especially for made-to-measure pieces.',
            'If an item arrives damaged or clearly differs from the confirmed request, report the issue with photos so it can be reviewed fairly.',
          ],
        },
      ],
    },
  },
  {
    slug: 'privacy',
    pl: {
      eyebrow: 'Prywatność',
      title: 'Informacje o prywatności na prostej stronie statycznej.',
      intro:
        'Ta wersja MVP nie zawiera kont użytkowników, płatności, koszyka ani własnej bazy danych klientów.',
      updatedLabel: 'Ostatnia aktualizacja: lipiec 2026',
      sections: [
        {
          title: 'Dane przekazane dobrowolnie',
          body: [
            'W wiadomości dotyczącej produktu możesz dobrowolnie przekazać imię, adres e-mail, opis pomysłu, wymiary, miasto dostawy i dodatkowe uwagi.',
            'Dane te mogą być użyte wyłącznie do odpowiedzi na zapytanie, przygotowania wyceny i uzgodnienia szczegółów realizacji.',
          ],
        },
        {
          title: 'Brak kont i danych płatniczych',
          body: [
            'Strona nie tworzy kont użytkowników, nie przetwarza płatności, nie zapisuje danych kart i nie prowadzi koszyka zakupowego.',
            'Szczegóły płatności, dostawy lub produkcji są uzgadniane poza tą statyczną stroną po potwierdzeniu zapytania.',
          ],
        },
        {
          title: 'Hosting strony',
          body: [
            'Strona jest hostowana statycznie i infrastruktura hostingowa może przetwarzać podstawowe dane techniczne potrzebne do wyświetlenia witryny.',
          ],
        },
        {
          title: 'Przechowywanie i usuwanie',
          body: [
            'Wiadomości dotyczące zapytań mogą być przechowywane tak długo, jak jest to potrzebne do udzielenia odpowiedzi, przygotowania lub realizacji zamówienia oraz spełnienia obowiązków prawnych.',
          ],
        },
      ],
    },
    en: {
      eyebrow: 'Privacy',
      title: 'Privacy information for a simple static website.',
      intro:
        'This MVP does not include user accounts, payments, a shopping cart, or a customer database.',
      updatedLabel: 'Last updated: July 2026',
      sections: [
        {
          title: 'Information you choose to send',
          body: [
            'A product inquiry may voluntarily include your name, email address, idea, dimensions, delivery city, and additional notes.',
            'This information may be used only to answer the inquiry, prepare a quote, and discuss production details.',
          ],
        },
        {
          title: 'No accounts or payment data',
          body: [
            'The website does not create user accounts, process payments, store card details, or operate a shopping cart.',
            'Payment, delivery, or production details are handled outside this static website after a request is confirmed.',
          ],
        },
        {
          title: 'Website hosting',
          body: [
            'The site is statically hosted, and the hosting infrastructure may process basic technical data required to deliver the website.',
          ],
        },
        {
          title: 'Retention and deletion',
          body: [
            'Inquiry messages may be retained as long as needed to answer questions, prepare or complete an order, and meet legal record-keeping requirements.',
          ],
        },
      ],
    },
  },
  {
    slug: 'terms',
    pl: {
      eyebrow: 'Warunki',
      title: 'Podstawowe warunki korzystania ze strony i składania zapytań.',
      intro:
        'Poniższe informacje wyjaśniają zasady korzystania ze statycznej wersji MVP i pomagają jasno określić oczekiwania przed wdrożeniem funkcji e-commerce.',
      updatedLabel: 'Ostatnia aktualizacja: lipiec 2026',
      sections: [
        {
          title: 'Treści na stronie',
          body: [
            'Opisy produktów, ceny, kolory i przykłady mają charakter informacyjny i mogą być aktualizowane wraz z rozwojem kolekcji MVP.',
            'Cena początkowa nie jest ostateczną ofertą dla każdej personalizacji. Wycena jest potwierdzana indywidualnie przed produkcją.',
          ],
        },
        {
          title: 'Zapytania indywidualne',
          body: [
            'Wysłanie zapytania nie tworzy automatycznie zamówienia. Rozpoczyna rozmowę o wykonalności, wykończeniu, cenie, terminie i dostawie.',
            'VITAO może odrzucić zapytanie, którego nie da się bezpiecznie wykonać, które nie odpowiada właściwościom materiału lub wykracza poza aktualny zakres pracowni.',
          ],
        },
        {
          title: 'Korzystanie ze strony',
          body: [
            'Korzystaj ze strony do przeglądania produktów i składania uzasadnionych zapytań. Nie zakłócaj działania witryny ani nie wykorzystuj jej treści w sposób wprowadzający w błąd.',
            'Zdjęcia, nazwy produktów, teksty i prezentacja marki VITAO nie powinny być wykorzystywane bez zgody.',
          ],
        },
        {
          title: 'Aktualizacje',
          body: [
            'Warunki mogą być aktualizowane wraz z rozwojem procesu zamówień.',
            'Przed uruchomieniem e-commerce, płatności lub kont użytkowników warunki powinny zostać ponownie zweryfikowane i rozszerzone.',
          ],
        },
      ],
    },
    en: {
      eyebrow: 'Terms',
      title: 'Basic terms for browsing the website and submitting inquiries.',
      intro:
        'These notes explain how the static MVP should be used and keep expectations clear before ecommerce features are introduced.',
      updatedLabel: 'Last updated: July 2026',
      sections: [
        {
          title: 'Website content',
          body: [
            'Product descriptions, prices, colors, and examples are for general guidance and may be updated as the MVP collection develops.',
            'A starting price is not a final offer for every customization. Each quote is confirmed individually before production.',
          ],
        },
        {
          title: 'Custom requests',
          body: [
            'Submitting a request does not create an automatic order. It starts a conversation about feasibility, finish, price, timing, and delivery.',
            'VITAO may decline requests that cannot be produced safely, do not suit the material, or fall outside the studio’s current scope.',
          ],
        },
        {
          title: 'Use of the website',
          body: [
            'Use the website for normal browsing and legitimate product inquiries. Do not disrupt the site or reuse its content in a misleading way.',
            'Images, product names, written content, and the VITAO brand presentation should not be reused without permission.',
          ],
        },
        {
          title: 'Updates',
          body: [
            'These terms may be updated as the ordering process develops.',
            'Before ecommerce, payments, or user accounts are introduced, the terms should be reviewed and expanded.',
          ],
        },
      ],
    },
  },
];

export function getInfoPages(language: Language): InfoPage[] {
  return localizedInfoPages.map(({ slug, ...page }) => ({ slug, ...page[language] }));
}

export function getInfoPageBySlug(slug: string, language: Language): InfoPage | undefined {
  return getInfoPages(language).find((page) => page.slug === slug);
}
