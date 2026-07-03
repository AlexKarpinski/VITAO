import { describe, expect, it } from 'vitest';
import { buildCustomRequestEmail } from './customRequest';

describe('custom request email helper', () => {
  it('includes all useful request context in the email body', () => {
    const email = buildCustomRequestEmail({
      name: 'Marta',
      email: 'marta@example.com',
      productName: 'Ridge Tray',
      dimensions: '18 × 10 × 2 cm',
      color: 'Stone',
      quantity: '2',
      deliveryCity: 'Warsaw',
      notes: 'One for an entry table and one for a desk.',
    });

    expect(email.subject).toBe('VITAO request: Ridge Tray from Marta');
    expect(email.body).toContain('Product / idea: Ridge Tray');
    expect(email.body).toContain('Dimensions: 18 × 10 × 2 cm');
    expect(email.body).toContain('Preferred color: Stone');
    expect(email.body).toContain('Quantity: 2');
    expect(email.body).toContain('Delivery city: Warsaw');
    expect(email.body).toContain('One for an entry table and one for a desk.');
  });
});
