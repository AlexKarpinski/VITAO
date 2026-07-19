import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageContext';
import { CustomOrder } from './CustomOrder';

const STORAGE_KEY = 'vitao-custom-request-draft';

function renderPage(initialEntry = '/custom-order') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LanguageProvider>
        <CustomOrder />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

function storedDraft(draft: Record<string, unknown>, expiresAt = Date.now() + 60_000) {
  return JSON.stringify({ draft, expiresAt });
}

function fillRequiredRequest(productName: string) {
  fireEvent.change(screen.getByLabelText('Imię'), { target: { value: 'Vita' } });
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'vita@example.com' } });
  fireEvent.change(screen.getByLabelText('Produkt lub pomysł'), { target: { value: productName } });
  fireEvent.change(screen.getByLabelText('Wymiary'), { target: { value: '30 × 20 cm' } });
  fireEvent.change(screen.getByLabelText('Preferowany kolor'), { target: { value: 'White' } });
  fireEvent.change(screen.getByLabelText('Liczba sztuk'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Miasto dostawy'), { target: { value: 'Gdynia' } });
  fireEvent.change(screen.getByLabelText('Uwagi'), { target: { value: 'Matte finish' } });
}

function fillRequiredRequestEn(productName: string) {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Vita' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'vita@example.com' } });
  fireEvent.change(screen.getByLabelText('Product or idea'), { target: { value: productName } });
  fireEvent.change(screen.getByLabelText('Dimensions'), { target: { value: '30 × 20 cm' } });
  fireEvent.change(screen.getByLabelText('Preferred color'), { target: { value: 'White' } });
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Delivery city'), { target: { value: 'Gdynia' } });
  fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Matte finish' } });
}

describe('CustomOrder fallback flow', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('restores a saved draft and keeps a requested product from the URL', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      storedDraft({
        name: 'Alex',
        email: 'alex@example.com',
        productName: 'Saved product',
        dimensions: '20 × 10 cm',
        color: 'Black',
        quantity: '2',
        deliveryCity: 'Gdańsk',
        notes: 'Rounded corners',
      }),
    );

    renderPage('/custom-order?product=Ridge%20Tray');

    expect(screen.getByLabelText('Imię')).toHaveValue('Alex');
    expect(screen.getByLabelText('Produkt lub pomysł')).toHaveValue('Ridge Tray');
    expect(screen.getByLabelText('Miasto dostawy')).toHaveValue('Gdańsk');
  });

  it('removes an expired saved draft', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      storedDraft({ name: 'Expired', productName: 'Old product' }, Date.now() - 1),
    );

    renderPage();

    expect(screen.getByLabelText('Imię')).toHaveValue('');
    expect(screen.getByLabelText('Produkt lub pomysł')).toHaveValue('');
  });

  it('restores only known string fields and drops unknown stored data', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      storedDraft({
        name: 42,
        email: null,
        productName: 'Saved product',
        quantity: false,
        internalNote: 'must not survive',
      }),
    );

    renderPage();

    expect(screen.getByLabelText('Imię')).toHaveValue('');
    expect(screen.getByLabelText('E-mail')).toHaveValue('');
    expect(screen.getByLabelText('Produkt lub pomysł')).toHaveValue('Saved product');
    expect(screen.getByLabelText('Liczba sztuk')).toHaveValue('1');

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
      expect(saved.draft.internalNote).toBeUndefined();
      expect(Object.keys(saved.draft).sort()).toEqual([
        'color',
        'deliveryCity',
        'dimensions',
        'email',
        'name',
        'notes',
        'productName',
        'quantity',
      ]);
    });
  });

  it('persists edits with an expiry, generates a preview, and copies the exact request text', async () => {
    renderPage();
    fillRequiredRequest('Organizer');

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
      expect(saved.draft).toMatchObject({
        name: 'Vita',
        productName: 'Organizer',
        deliveryCity: 'Gdynia',
      });
      expect(saved.expiresAt).toBeGreaterThan(Date.now());
      expect(saved.expiresAt).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Przygotuj zapytanie' }));

    const preview = screen.getByRole('textbox', { name: 'Podgląd zapytania' }) as HTMLTextAreaElement;
    expect(preview.value).toContain('Imię: Vita');
    expect(preview.value).toContain('Produkt lub pomysł: Organizer');
    expect(screen.queryByText(/hello@vitao\.studio/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Kopiuj zapytanie' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(preview.value);
      expect(screen.getByRole('status')).toHaveTextContent('Treść zapytania została skopiowana.');
    });
  });

  it('clears the saved draft and preview on request', async () => {
    renderPage();
    fillRequiredRequest('Organizer');
    fireEvent.click(screen.getByRole('button', { name: 'Przygotuj zapytanie' }));

    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść zapisany szkic' }));

    expect(screen.getByLabelText('Imię')).toHaveValue('');
    expect(screen.getByLabelText('Produkt lub pomysł')).toHaveValue('');
    expect(screen.queryByRole('textbox', { name: 'Podgląd zapytania' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Zapisany szkic został usunięty.');

    await waitFor(() => {
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  it('generates and copies an English request when the persisted language is English', async () => {
    window.localStorage.setItem('vitao-language', 'en');
    renderPage();
    fillRequiredRequestEn('Ridge Tray');

    fireEvent.click(screen.getByRole('button', { name: 'Prepare inquiry' }));

    const preview = screen.getByRole('textbox', { name: 'Inquiry preview' }) as HTMLTextAreaElement;
    expect(preview.value).toContain('Name: Vita');
    expect(preview.value).toContain('Product or idea: Ridge Tray');
    expect(document.documentElement.lang).toBe('en');
    expect(screen.queryByText(/hello@vitao\.studio/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy inquiry' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(preview.value);
      expect(screen.getByRole('status')).toHaveTextContent('The inquiry text was copied.');
    });
  });

  it('keeps the generated request visible when automatic copying fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('Clipboard unavailable')) },
    });

    renderPage();
    fillRequiredRequest('Ridge Tray');
    fireEvent.click(screen.getByRole('button', { name: 'Przygotuj zapytanie' }));

    const preview = screen.getByRole('textbox', { name: 'Podgląd zapytania' }) as HTMLTextAreaElement;
    const requestText = preview.value;

    fireEvent.click(screen.getByRole('button', { name: 'Kopiuj zapytanie' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Nie udało się skopiować automatycznie. Zaznacz tekst podglądu i skopiuj go ręcznie.',
      );
    });
    expect(preview).toHaveValue(requestText);
    expect(preview).toHaveAttribute('readonly');
  });

  it('falls back to manual copying when the Clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });

    renderPage();
    fillRequiredRequest('Dune Cosmetic Organizer');
    fireEvent.click(screen.getByRole('button', { name: 'Przygotuj zapytanie' }));

    const preview = screen.getByRole('textbox', { name: 'Podgląd zapytania' }) as HTMLTextAreaElement;
    const requestText = preview.value;

    fireEvent.click(screen.getByRole('button', { name: 'Kopiuj zapytanie' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Nie udało się skopiować automatycznie. Zaznacz tekst podglądu i skopiuj go ręcznie.',
      );
    });
    expect(preview).toHaveValue(requestText);
    expect(preview).toHaveAttribute('readonly');
  });
});
