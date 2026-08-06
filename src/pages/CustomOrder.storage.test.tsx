import { cleanup, render, waitFor } from '@testing-library/react';
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

describe('CustomOrder draft storage lifecycle', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('does not recreate an empty envelope after removing an expired draft', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        draft: { name: 'Expired', productName: 'Old product' },
        expiresAt: Date.now() - 1,
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });
});
