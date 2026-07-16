import { Link } from 'react-router-dom';
import { Language, useLanguage } from '../../i18n/LanguageContext';

const footerContent = {
  pl: {
    tagline: 'Przedmioty na zamówienie do spokojnych, nowoczesnych wnętrz.',
    details: 'Gdańsk / Trójmiasto, Polska • Dostawa na terenie całej Polski',
    response: 'Odpowiadamy zwykle w ciągu 1–2 dni roboczych.',
    navigationLabel: 'Informacje prawne i dotyczące zamówień',
    links: [
      ['Informacje o zamówieniu', '/info/order-info'],
      ['Prywatność', '/info/privacy'],
      ['Regulamin', '/info/terms'],
    ],
  },
  en: {
    tagline: 'Custom objects for calm, modern spaces.',
    details: 'Gdańsk / Trójmiasto, Poland • Delivery across Poland',
    response: 'We usually respond within 1–2 business days.',
    navigationLabel: 'Legal and order information',
    links: [
      ['Order information', '/info/order-info'],
      ['Privacy', '/info/privacy'],
      ['Terms', '/info/terms'],
    ],
  },
} satisfies Record<Language, { tagline: string; details: string; response: string; navigationLabel: string; links: string[][] }>;

export function Footer() {
  const { language } = useLanguage();
  const content = footerContent[language];

  return (
    <footer className="site-footer">
      <div>
        <strong>VITAO</strong>
        <p>{content.tagline}</p>
      </div>
      <div>
        <p>{content.details}</p>
        <p>{content.response}</p>
      </div>
      <nav className="footer-links" aria-label={content.navigationLabel}>
        {content.links.map(([label, path]) => <Link key={path} to={path}>{label}</Link>)}
      </nav>
    </footer>
  );
}
