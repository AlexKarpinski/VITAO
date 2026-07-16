import { Link } from 'react-router-dom';
import { Language, useLanguage } from '../../i18n/LanguageContext';

const footerContent = {
  pl: {
    tagline: 'Przedmioty na zamówienie do spokojnych, nowoczesnych wnętrz.',
    details: 'Na zamówienie • Ciepły minimalizm • Mała pracownia',
    navigationLabel: 'Informacje prawne i dotyczące zamówień',
    links: [
      ['Informacje o zamówieniu', '/info/order-info'],
      ['Prywatność', '/info/privacy'],
      ['Regulamin', '/info/terms'],
    ],
  },
  en: {
    tagline: 'Custom objects for calm, modern spaces.',
    details: 'Made to order • Warm minimal • Small studio',
    navigationLabel: 'Legal and order information',
    links: [
      ['Order information', '/info/order-info'],
      ['Privacy', '/info/privacy'],
      ['Terms', '/info/terms'],
    ],
  },
} satisfies Record<Language, { tagline: string; details: string; navigationLabel: string; links: string[][] }>;

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
      </div>
      <nav className="footer-links" aria-label={content.navigationLabel}>
        {content.links.map(([label, path]) => <Link key={path} to={path}>{label}</Link>)}
      </nav>
    </footer>
  );
}
