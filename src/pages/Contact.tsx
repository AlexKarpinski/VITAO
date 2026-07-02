import { Button } from '../components/ui/Button';
import { SectionLabel } from '../components/ui/SectionLabel';

const faqs = ['How do custom orders work?', 'Can I request a different color or size?', 'Do you offer checkout?', 'What should I include in an inquiry?'];

export function Contact() {
  return <section className="page"><SectionLabel>Contact + FAQ</SectionLabel><h1>Questions, requests, and custom ideas are welcome.</h1><div className="contact-cards"><article><h3>Email</h3><p>hello@vitao.studio</p><Button href="mailto:hello@vitao.studio">Send email</Button></article><article><h3>Instagram</h3><p>@vitao.studio</p><Button href="#/custom" variant="secondary">Request piece</Button></article><article><h3>Telegram</h3><p>@vitaostudio</p><Button href="#/products" variant="secondary">Browse first</Button></article></div><div className="faq">{faqs.map((faq) => <article key={faq}><h3>{faq}</h3><p>Send a short message and VITAO will reply with practical next steps, options, and any quote details needed.</p></article>)}</div></section>;
}
