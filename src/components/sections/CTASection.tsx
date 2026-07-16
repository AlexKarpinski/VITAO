import { useLanguage } from '../../i18n/LanguageContext';
import { Button } from '../ui/Button';

const content = {
  pl: {
    eyebrow: 'Dopasowane do Ciebie',
    title: 'Masz przestrzeń, przedmiot lub codzienny rytuał, który potrzebuje lepszego dopasowania?',
    body: 'Prześlij kilka wymiarów lub proste zdjęcie. Przekształcimy pomysł w dopracowany przedmiot na zamówienie i potwierdzimy wycenę przed rozpoczęciem produkcji.',
    action: 'Poproś o indywidualny projekt',
  },
  en: {
    eyebrow: 'Made around you',
    title: 'Have a space, object, or routine that needs a better fit?',
    body: 'Send a few measurements or a simple photo. We will shape the idea into a refined made-to-order piece and confirm the quote before production.',
    action: 'Request a custom piece',
  },
};

export function CTASection() {
  const { language } = useLanguage();
  const copy = content[language];

  return (
    <section className="cta-section">
      <p className="eyebrow">{copy.eyebrow}</p>
      <h2>{copy.title}</h2>
      <p>{copy.body}</p>
      <Button to="/custom">{copy.action}</Button>
    </section>
  );
}
