import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('CustomOrder persistence recovery', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('preserves unsaved fields when a failed write is followed by another edit', async () => {
    const expiresAt = Date.now() + 60_000;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        draft: {
          name: 'Alex',
          email: 'alex@example.com',
          productName: 'Organizer',
          dimensions: '20 × 10 cm',
          color: 'Biały',
          quantity: '1',
          deliveryCity: 'Gdańsk',
          notes: 'Stored note',
        },
        expiresAt,
      }),
    );

    renderPage();

    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    setItem.mockImplementationOnce(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    fireEvent.change(screen.getByLabelText('Uwagi'), {
      target: { value: 'Unsaved note after quota failure' },
    });

    expect(screen.getByLabelText('Uwagi')).toHaveValue('Unsaved note after quota failure');

    setItem.mockRestore();

    fireEvent.change(screen.getByLabelText('Preferowany kolor'), {
      target: { value: 'Grafitowy' },
    });

    expect(screen.getByLabelText('Uwagi')).toHaveValue('Unsaved note after quota failure');

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
      expect(stored.expiresAt).toBeGreaterThan(expiresAt);
      expect(stored.draft.notes).toBe('Unsaved note after quota failure');
      expect(stored.draft.color).toBe('Grafitowy');
    });
  });
});
