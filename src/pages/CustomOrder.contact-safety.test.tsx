import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageContext';
import { CustomOrder } from './CustomOrder';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/custom-order']}>
      <LanguageProvider>
        <CustomOrder />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

describe('CustomOrder contact safety', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps the Polish-first page explicit about the inactive destination without exposing a mail link', () => {
    renderPage();

    expect(
      screen.getByText(/Oficjalny kanał wysyłki nie został jeszcze publicznie potwierdzony/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/hello@vitao\.studio/i)).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(screen.queryByText(/official inquiry destination/i)).not.toBeInTheDocument();
    expect(document.documentElement.lang).toBe('pl');
  });

  it('shows only the English contact instruction when English is selected', () => {
    window.localStorage.setItem('vitao-language', 'en');
    renderPage();

    expect(
      screen.getByText(/The official inquiry destination has not been publicly confirmed yet/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Oficjalny kanał wysyłki/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/hello@vitao\.studio/i)).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(document.documentElement.lang).toBe('en');
  });
});
