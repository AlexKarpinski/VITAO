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

export const infoPages: InfoPage[] = [
  {
    slug: 'order-info',
    eyebrow: 'Order information',
    title: 'How made-to-order pieces are requested, quoted, and prepared.',
    intro:
      'VITAO is currently a conversation-first MVP. Products show starting prices, while each custom or adjusted piece is confirmed by email before anything is produced.',
    updatedLabel: 'Updated for MVP launch',
    sections: [
      {
        title: 'Requesting a piece',
        body: [
          'Start with the product name or custom idea, approximate dimensions, preferred color, quantity, delivery city, and any notes about the space or routine it should improve.',
          'Photos, sketches, or reference measurements are helpful, especially for organizers, stands, drawer inserts, and pieces made to fit an existing object.',
        ],
      },
      {
        title: 'Quotes and confirmation',
        body: [
          'Catalog prices are starting points. Final pricing depends on size, finish direction, quantity, and the amount of customization needed.',
          'A clear quote, estimated timing, and any practical limitations are confirmed before production starts. No checkout or automatic payment flow is included on this MVP website.',
        ],
      },
      {
        title: 'Production timing',
        body: [
          'Most small made-to-order objects are planned in batches. Timing is confirmed with the quote and may vary when a piece needs extra design adjustment or a specific finish.',
          'If a request is time-sensitive, include the needed date in the first message so expectations can be discussed early.',
        ],
      },
      {
        title: 'Delivery and pickup',
        body: [
          'Delivery options and costs are confirmed individually based on destination, parcel size, and the safest way to package the object.',
          'The delivery city is requested in the inquiry form so the first reply can include realistic next steps.',
        ],
      },
      {
        title: 'Changes, returns, and custom fit',
        body: [
          'Because many pieces are made or adjusted for a specific request, changes should be shared before production is confirmed.',
          'If something arrives damaged or meaningfully different from the confirmed request, contact VITAO with photos so the issue can be reviewed and resolved fairly.',
        ],
      },
    ],
  },
  {
    slug: 'privacy',
    eyebrow: 'Privacy',
    title: 'Privacy notes for a simple static website.',
    intro:
      'This MVP is designed to collect only the information needed to answer product questions and custom order requests. It does not include accounts, checkout, or a customer database.',
    updatedLabel: 'Last updated: July 2026',
    sections: [
      {
        title: 'Information you choose to send',
        body: [
          'When you contact VITAO by email, Instagram, Telegram, or the request form mailto link, you may share your name, email address, product idea, dimensions, delivery city, and project notes.',
          'That information is used to reply to your inquiry, prepare a quote, discuss production details, and keep a practical record of the conversation.',
        ],
      },
      {
        title: 'No accounts or checkout data',
        body: [
          'The website does not create user accounts, process payments, store card details, or operate a shopping cart.',
          'Any payment, delivery, or production details are handled outside this static website and only after a request is confirmed in conversation.',
        ],
      },
      {
        title: 'Website hosting and links',
        body: [
          'The site is intended for static hosting and may be served through GitHub Pages or similar infrastructure, which can process basic technical data needed to deliver the page.',
          'External links such as Instagram or Telegram are governed by their own privacy practices once you leave the VITAO website.',
        ],
      },
      {
        title: 'Retention and deletion',
        body: [
          'Inquiry messages may be kept as long as needed to answer questions, prepare or complete an order, and maintain basic business records.',
          'You can ask for an inquiry conversation to be deleted when it is no longer needed, subject to any practical or legal record-keeping requirements.',
        ],
      },
    ],
  },
  {
    slug: 'terms',
    eyebrow: 'Terms',
    title: 'Simple terms for browsing and requesting VITAO pieces.',
    intro:
      'These notes explain how the static MVP should be used. They are written to keep expectations clear while VITAO validates demand before adding ecommerce features.',
    updatedLabel: 'Last updated: July 2026',
    sections: [
      {
        title: 'Website content',
        body: [
          'Product descriptions, prices, colors, and examples are provided for general guidance and may be refined as the MVP collection evolves.',
          'Starting prices are not final offers for every possible customization. A quote is confirmed individually before production.',
        ],
      },
      {
        title: 'Custom requests',
        body: [
          'Submitting a request does not create an automatic order. It opens a conversation about feasibility, finish, price, timing, and delivery.',
          'VITAO may decline requests that are outside the current scope, unsafe to produce, unsuitable for the material, or not aligned with the studio direction.',
        ],
      },
      {
        title: 'Use of the website',
        body: [
          'Use the website for normal browsing, product discovery, and inquiries. Do not misuse contact channels, copy site content for misleading purposes, or attempt to disrupt the site.',
          'Images, product names, written content, and the VITAO brand presentation should not be reused without permission.',
        ],
      },
      {
        title: 'Updates',
        body: [
          'These terms may be updated as the MVP becomes a more complete ordering experience.',
          'If ecommerce, payments, or accounts are added later, the terms should be reviewed and expanded before launch.',
        ],
      },
    ],
  },
];

export function getInfoPageBySlug(slug: string): InfoPage | undefined {
  return infoPages.find((page) => page.slug === slug);
}
