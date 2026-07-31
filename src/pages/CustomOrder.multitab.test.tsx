import { cleanup, render } from '@testing-library/react';
import { act } from 'react';
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

describe('CustomOrder multi-tab draft expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('does not delete a draft whose expiry was renewed by another tab', () => {
    const originalExpiry = Date.now() + 1_000;
    const renewedExpiry = Date.now() + 10_000;

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        draft: { name: 'Alex', productName: 'Organizer' },
        expiresAt: originalExpiry,
      }),
    );

    renderPage();

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        draft: { name: 'Alex', productName: 'Updated organizer' },
        expiresAt: renewedExpiry,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(1_001);
    });

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored.expiresAt).toBe(renewedExpiry);
    expect(stored.draft.productName).toBe('Updated organizer');
  });
});
