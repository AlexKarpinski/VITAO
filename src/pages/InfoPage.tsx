import { Link, useParams } from 'react-router-dom';
import { PageHero } from '../components/ui/PageHero';
import { getInfoPageBySlug, infoPages } from '../data/infoPages';

export function InfoPage() {
  const { slug = '' } = useParams();
  const page = getInfoPageBySlug(slug);

  if (!page) {
    return (
      <section className="page-hero">
        <p className="eyebrow">Information</p>
        <h1>We could not find that page.</h1>
        <p>Return to the order information, privacy notes, or terms pages from the links below.</p>
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
          <p className="eyebrow">Details</p>
          <p>{page.updatedLabel}</p>
          <nav className="info-nav" aria-label="Legal and order information pages">
            {infoPages.map((infoPage) => (
              <Link key={infoPage.slug} to={`/info/${infoPage.slug}`}>
                {infoPage.eyebrow}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="info-content">
          <h2 id="info-page-sections">Important information</h2>
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
