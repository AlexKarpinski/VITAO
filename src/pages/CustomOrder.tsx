import { FormEvent, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHero } from '../components/ui/PageHero';
import { buildCustomRequestEmail, requestResponseTime } from '../data/customRequest';

const inquiryEmail = 'hello@vitao.studio';
const steps = [
  'Choose a product to adjust or describe the object, shelf, drawer, desk, or routine you want to improve.',
  'Share the practical details: dimensions, preferred color, quantity, delivery city, and any notes about use.',
  'We reply with questions, material and finish suggestions, next steps, and a clear starting quote before production.',
];

const requestDetails = [
  'Product name or custom idea',
  'Approximate dimensions or the item it needs to fit',
  'Preferred color or finish direction',
  'Quantity and delivery city',
  'Notes about the space, use case, timing, or constraints',
];

export function CustomOrder() {
  const [searchParams] = useSearchParams();
  const requestedProduct = useMemo(() => searchParams.get('product') ?? '', [searchParams]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [productName, setProductName] = useState(requestedProduct);
  const [dimensions, setDimensions] = useState('');
  const [color, setColor] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [notes, setNotes] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const { subject, body } = buildCustomRequestEmail({
      name,
      email,
      productName,
      dimensions,
      color,
      quantity,
      deliveryCity,
      notes,
    });

    window.location.href = `mailto:${inquiryEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <>
      <PageHero eyebrow="Custom request" title="Ask for a piece made around your space.">
        Send a product question or custom idea with the details we need to respond clearly. Custom pieces begin from 189 zł, with a confirmed quote before anything is made.
      </PageHero>
      <section className="split split--top">
        <div>
          <p className="eyebrow">Request flow</p>
          <h2>What to include</h2>
          <p>
            A thoughtful request helps us understand the object, the space, and the finish you have in mind without adding checkout or automated forms to this MVP.
          </p>
          <div className="request-list" aria-label="Useful request details">
            {requestDetails.map((detail) => <p key={detail}>{detail}</p>)}
          </div>
          <p className="response-note"><strong>Response time.</strong> {requestResponseTime}</p>
          <h2>How it works</h2>
          {steps.map((step, index) => <p className="step" key={step}><strong>{index + 1}</strong>{step}</p>)}
        </div>
        <form className="form" onSubmit={handleSubmit}>
          <p className="form-note">This no-backend MVP opens your email app with the inquiry details pre-filled.</p>
          <label>Name<input placeholder="Your name" value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label>Email<input placeholder="you@example.com" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Product or idea<input placeholder="Ridge Tray, controller stand, drawer insert..." value={productName} onChange={(event) => setProductName(event.target.value)} required /></label>
          <label>Dimensions<input placeholder="Approx. 18 × 10 × 2 cm, shelf width, object size..." value={dimensions} onChange={(event) => setDimensions(event.target.value)} required /></label>
          <label>Preferred color<input placeholder="Warm ivory, stone, graphite, olive..." value={color} onChange={(event) => setColor(event.target.value)} required /></label>
          <label>Quantity<input placeholder="1" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
          <label>Delivery city<input placeholder="Warsaw, Kraków, Gdańsk..." value={deliveryCity} onChange={(event) => setDeliveryCity(event.target.value)} required /></label>
          <label>Notes<textarea placeholder="Tell us about the space, use case, timing, or any constraints." value={notes} onChange={(event) => setNotes(event.target.value)} required /></label>
          <button type="submit">Prepare request email</button>
        </form>
      </section>
    </>
  );
}
