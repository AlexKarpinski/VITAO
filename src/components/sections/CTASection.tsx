import { Button } from '../ui/Button';
import { SectionLabel } from '../ui/SectionLabel';

export function CTASection() {
  return <section className="cta-section"><SectionLabel>Custom orders</SectionLabel><h2>Have a specific size, routine, or awkward corner in mind?</h2><p>Send a quick note with measurements, photos, or a sketch. We will suggest a refined object that fits your space.</p><Button href="#/custom">Request a custom piece</Button></section>;
}
