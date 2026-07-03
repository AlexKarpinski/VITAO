import { PageHero } from '../components/ui/PageHero';

export function About() {
  return (
    <>
      <PageHero eyebrow="About VITAO" title="A small studio for functional everyday objects.">
        VITAO creates calm, useful pieces for modern rooms and routines, combining made-to-order flexibility with a refined studio sensibility.
      </PageHero>
      <section className="feature-grid">
        <article>
          <h3>Thoughtful function</h3>
          <p>Each object starts with a real surface, habit, or storage problem before the form is refined.</p>
        </article>
        <article>
          <h3>Warm minimalism</h3>
          <p>Quiet shapes and neutral finishes help pieces live naturally in homes, workspaces, and studios.</p>
        </article>
        <article>
          <h3>Made with care</h3>
          <p>Small-batch production keeps the process personal, flexible, and focused on the details that matter.</p>
        </article>
      </section>
    </>
  );
}
