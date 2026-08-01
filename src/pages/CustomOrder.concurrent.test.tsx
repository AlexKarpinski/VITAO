import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageContext';
import { CustomOrder } from './CustomOrder';

const STORAGE_KEY = 'vitao-custom-request-draft';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/custom-order']}>
      <LanguageProvider>
        <CustomOrder />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

function fillRequiredRequest() {
  fireEvent.change(screen.getByLabelText('Imię'), { target: { value: 'Vita' } });
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'vita@example.com' } });
  fireEvent.change(screen.getByLabelText('Produkt lub pomysł'), { target: { value: 'Organizer' } });
  fireEvent.change(screen.getByLabelText('Wymiary'), { target: { value: '30 × 20 cm' } });
  fireEvent.change(screen.getByLabelText('Preferowany kolor'), { target: { value: 'Biały' } });
  fireEvent.change(screen.getByLabelText('Liczba sztuk'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Miasto dostawy'), { target: { value: 'Gdańsk' } });
  fireEvent.change(screen.getByLabelText('Uwagi'), { target: { value: 'Matowe wykończenie' } });
}

describe('CustomOrder concurrent edits and prepared-state validity', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('merges the latest stored draft before a stale tab writes one edited field', async () => {
    const expiresAt = Date.now() + 60_000;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        draft: {
          name: 'Alex',
          email: 'old@example.com',
          productName: 'Organizer',
          dimensions: '20 × 10 cm',
          color: 'Biały',
          quantity: '1',
          deliveryCity: 'Gdańsk',
          notes: 'Old note',
        },
        expiresAt,
      }),
    );

    renderPage();

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        draft: {
          name: 'Alex',
          email: 'new@example.com',
          productName: 'Organizer',
          dimensions: '20 × 10 cm',
          color: 'Biały',
          quantity: '1',
          deliveryCity: 'Gdańsk',
          notes: 'Updated in another tab',
        },
        expiresAt: expiresAt + 10_000,
      }),
    );

    fireEvent.change(screen.getByLabelText('Preferowany kolor'), { target: { value: 'Grafitowy' } });

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
      expect(stored.draft.email).toBe('new@example.com');
      expect(stored.draft.notes).toBe('Updated in another tab');
      expect(stored.draft.color).toBe('Grafitowy');
    });
  });

  it('hides a prepared inquiry when a later edit makes the form invalid', () => {
    renderPage();
    fillRequiredRequest();

    fireEvent.click(screen.getByRole('button', { name: 'Przygotuj zapytanie' }));
    expect(screen.getByRole('heading', { name: 'Podgląd zapytania' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Zapytanie jest gotowe');

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: '' } });

    expect(screen.queryByRole('heading', { name: 'Podgląd zapytania' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
