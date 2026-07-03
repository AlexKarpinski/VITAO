import { FormEvent, useState } from 'react';
import { PageHero } from '../components/ui/PageHero';

const inquiryEmail = 'hello@vitao.studio';

export function CustomOrder() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [details, setDetails] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const subject = encodeURIComponent(`Custom VITAO inquiry from ${name || 'a visitor'}`);
    const body = encodeURIComponent([
      `Name: ${name}`,
      `Email: ${email}`,
      '',
      'Custom request:',
      details,
    ].join('\n'));

    window.location.href = `mailto:${inquiryEmail}?subject=${subject}&body=${body}`;
  }

  return <><PageHero eyebrow="Custom order" title="A refined object, shaped around your space.">Tell us what you want to organize, display, hold, or improve. MVP inquiries are handled by conversation before any production starts.</PageHero><section className="split"><div><h2>How it works</h2>{['Share the idea, space, and rough measurements.','We suggest a form, finish, and starting quote.','Your piece is made to order after details are confirmed.'].map((s,i)=><p className="step" key={s}><strong>{i+1}</strong>{s}</p>)}</div><form className="form" onSubmit={handleSubmit}><p className="form-note">This no-backend MVP opens your email app with the inquiry details pre-filled.</p><label>Name<input placeholder="Your name" value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Email<input placeholder="you@example.com" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>What should we make?<textarea placeholder="Describe the object, size, use case, and preferred colors." value={details} onChange={(event) => setDetails(event.target.value)} required /></label><button type="submit">Prepare inquiry</button></form></section></>;
}
