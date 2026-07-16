import { PageHero } from '../components/ui/PageHero';
import { useLanguage } from '../i18n/LanguageContext';

const aboutContent = {
  pl: {
    eyebrow: 'O VITAO',
    title: 'Mała pracownia funkcjonalnych przedmiotów codziennego użytku.',
    intro:
      'VITAO tworzy spokojne, użyteczne przedmioty do nowoczesnych wnętrz i codziennych rytuałów, łącząc elastyczność produkcji na zamówienie z dopracowanym podejściem małej pracowni.',
    features: [
      {
        title: 'Przemyślana funkcja',
        body: 'Każdy przedmiot zaczyna się od rzeczywistej potrzeby związanej z powierzchnią, nawykiem lub przechowywaniem, a dopiero potem dopracowywana jest jego forma.',
      },
      {
        title: 'Ciepły minimalizm',
        body: 'Spokojne kształty i neutralne wykończenia pomagają przedmiotom naturalnie odnaleźć się w domu, miejscu pracy i pracowni.',
      },
      {
        title: 'Wykonane z dbałością',
        body: 'Produkcja w małych seriach pozwala zachować osobiste, elastyczne podejście i skupić się na detalach, które mają znaczenie.',
      },
    ],
  },
  en: {
    eyebrow: 'About VITAO',
    title: 'A small studio for functional everyday objects.',
    intro:
      'VITAO creates calm, useful pieces for modern rooms and routines, combining made-to-order flexibility with a refined studio sensibility.',
    features: [
      {
        title: 'Thoughtful function',
        body: 'Each object starts with a real surface, habit, or storage problem before the form is refined.',
      },
      {
        title: 'Warm minimalism',
        body: 'Quiet shapes and neutral finishes help pieces live naturally in homes, workspaces, and studios.',
      },
      {
        title: 'Made with care',
        body: 'Small-batch production keeps the process personal, flexible, and focused on the details that matter.',
      },
    ],
  },
};

export function About() {
  const { language } = useLanguage();
  const content = aboutContent[language];

  return (
    <>
      <PageHero eyebrow={content.eyebrow} title={content.title}>
        {content.intro}
      </PageHero>
      <section className="feature-grid">
        {content.features.map((feature) => (
          <article key={feature.title}>
            <h3>{feature.title}</h3>
            <p>{feature.body}</p>
          </article>
        ))}
      </section>
    </>
  );
}
