import { Button } from '../ui/Button';

export function CTASection() {
  return (
    <section className="cta-section">
      <p className="eyebrow">Made around you</p>
      <h2>Have a space, object, or routine that needs a better fit?</h2>
      <p>Send a few measurements or a simple photo. We will shape the idea into a refined made-to-order piece and confirm the quote before production.</p>
      <Button to="/custom">Request a custom piece</Button>
    </section>
  );
}
