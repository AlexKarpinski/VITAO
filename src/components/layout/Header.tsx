import { Link, NavLink } from 'react-router-dom';
import { Language, useLanguage } from '../../i18n/LanguageContext';

const links = {
  pl: [
    ['Strona główna', '/'],
    ['Produkty', '/products'],
    ['Zamówienie indywidualne', '/custom'],
    ['O nas', '/about'],
    ['Kontakt i FAQ', '/contact'],
  ],
  en: [
    ['Home', '/'],
    ['Products', '/products'],
    ['Custom Order', '/custom'],
    ['About', '/about'],
    ['Contact + FAQ', '/contact'],
  ],
} satisfies Record<Language, string[][]>;

export function Header() {
  const { language, setLanguage } = useLanguage();

  return (
    <header className="site-header">
      <Link className="brand" to="/">VITAO</Link>
      <nav aria-label={language === 'pl' ? 'Główna nawigacja' : 'Primary navigation'}>
        {links[language].map(([label, path]) => (
          <NavLink key={path} to={path} className={({ isActive }) => (isActive ? 'active' : '')}>
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="language-switch" aria-label={language === 'pl' ? 'Wybór języka' : 'Language selection'}>
        <button type="button" className={language === 'pl' ? 'active' : ''} onClick={() => setLanguage('pl')} aria-pressed={language === 'pl'}>
          PL
        </button>
        <button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')} aria-pressed={language === 'en'}>
          EN
        </button>
      </div>
    </header>
  );
}
