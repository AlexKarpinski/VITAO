import { PageHero } from '../components/ui/PageHero';
import { CTASection } from '../components/sections/CTASection';

const faqs = [
  ['Do you sell ready-made products?', 'The MVP collection uses starting prices and made-to-order requests rather than checkout. Each inquiry is confirmed by conversation first.'],
  ['Can I request a custom size?', 'Yes. Share the measurements, the object it needs to hold, and where the piece will live. Custom quotes currently start from 189 zł.'],
  ['How are prices confirmed?', 'Product pages show starting prices. Final pricing depends on size, finish, and customization, and is confirmed before production begins.'],
  ['Are there payments on the site?', 'No. This static MVP is designed to start conversations before checkout or payment tools are added.'],
];

export function Contact() {
  return (
    <>
      <PageHero eyebrow="Contact + FAQ" title="Ask about a piece or start a custom request.">
        Reach out by email, Instagram, or Telegram. A first note can be simple: product name, preferred color, rough dimensions, and where the piece will be used.
      </PageHero>
      <section className="contact-cards">
        <a href="mailto:hello@vitao.studio">hello@vitao.studio</a>
        <a href="https://instagram.com/" target="_blank">Instagram</a>
        <a href="https://telegram.org/" target="_blank">Telegram</a>
      </section>
      <section className="section">
        <p className="eyebrow">FAQ</p>
        {faqs.map(([question, answer]) => <article className="faq" key={question}><h3>{question}</h3><p>{answer}</p></article>)}
      </section>
      <CTASection />
    </>
  );
}
