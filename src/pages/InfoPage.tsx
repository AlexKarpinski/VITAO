import { Link, useParams } from 'react-router-dom';
import { PageHero } from '../components/ui/PageHero';
import { getInfoPageBySlug, getInfoPages } from '../data/infoPages';
import { useLanguage } from '../i18n/LanguageContext';

const labels = {
  pl: {
    missingEyebrow: 'Informacje',
    missingTitle: 'Nie znaleziono tej strony.',
    missingBody: 'Wróć do informacji o zamówieniu, prywatności lub warunków, korzystając z poniższych linków.',
    details: 'Szczegóły',
    navLabel: 'Informacje prawne i dotyczące zamówień',
    important: 'Ważne informacje',
  },
  en: {
    missingEyebrow: 'Information',
    missingTitle: 'We could not find that page.',
    missingBody: 'Return to the order information, privacy, or terms pages using the links below.',
    details: 'Details',
    navLabel: 'Legal and order information pages',
    important: 'Important information',
  },
} as const;

export function InfoPage() {
  const { slug = '' } = useParams();
  const { language } = useLanguage();
  const copy = labels[language];
  const infoPages = getInfoPages(language);
  const page = getInfoPageBySlug(slug, language);

  if (!page) {
    return (
      <section className="page-hero">
        <p className="eyebrow">{copy.missingEyebrow}</p>
        <h1>{copy.missingTitle}</h1>
        <p>{copy.missingBody}</p>
        <div className="actions">
          {infoPages.map((infoPage) => (
            <Link className="button button--secondary" key={infoPage.slug} to={`/info/${infoPage.slug}`}>
              {infoPage.eyebrow}
            </Link>
          ))}
        </div>
      </section>
    );
  }

  return (
    <>
      <PageHero eyebrow={page.eyebrow} title={page.title}>
        {page.intro}
      </PageHero>
      <section className="info-layout" aria-labelledby="info-page-sections">
        <aside className="info-sidebar">
          <p className="eyebrow">{copy.details}</p>
          <p>{page.updatedLabel}</p>
          <nav className="info-nav" aria-label={copy.navLabel}>
            {infoPages.map((infoPage) => (
              <Link key={infoPage.slug} to={`/info/${infoPage.slug}`}>
                {infoPage.eyebrow}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="info-content">
          <h2 id="info-page-sections">{copy.important}</h2>
          {page.sections.map((section) => (
            <article className="info-card" key={section.title}>
              <h3>{section.title}</h3>
              {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
