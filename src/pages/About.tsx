import { SectionLabel } from '../components/ui/SectionLabel';
import { CTASection } from '../components/sections/CTASection';

export function About() {
  return <><section className="page"><SectionLabel>About VITAO</SectionLabel><h1>A small studio for refined everyday objects.</h1><p className="lede">VITAO focuses on useful, tactile pieces that make modern spaces feel calmer. The work starts with simple needs: a neater desk, a better vanity layout, a stand that belongs in the room.</p><div className="feature-grid"><article><h3>Thoughtful utility</h3><p>Every object has a clear job and avoids decorative clutter.</p></article><article><h3>Small-batch care</h3><p>Pieces are made in considered runs, with custom adjustments where they matter.</p></article><article><h3>Material honesty</h3><p>Matte printed finishes are presented as clean design objects, not tech demos.</p></article></div></section><CTASection /></>;
}
