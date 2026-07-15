// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider, useLanguage } from './LanguageContext';

function LanguageProbe() {
  const { language, setLanguage } = useLanguage();

  return (
    <div>
      <span data-testid="language">{language}</span>
      <button type="button" onClick={() => setLanguage('en')}>English</button>
      <button type="button" onClick={() => setLanguage('pl')}>Polski</button>
    </div>
  );
}

function renderLanguageProvider() {
  return render(
    <LanguageProvider>
      <LanguageProbe />
    </LanguageProvider>,
  );
}

describe('LanguageProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = '';
  });

  it('uses Polish by default and synchronizes the document language', () => {
    renderLanguageProvider();

    expect(screen.getByTestId('language')).toHaveTextContent('pl');
    expect(window.localStorage.getItem('vitao-language')).toBe('pl');
    expect(document.documentElement.lang).toBe('pl');
  });

  it('switches to English and persists the selection', () => {
    const view = renderLanguageProvider();

    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(screen.getByTestId('language')).toHaveTextContent('en');
    expect(window.localStorage.getItem('vitao-language')).toBe('en');
    expect(document.documentElement.lang).toBe('en');

    view.unmount();
    renderLanguageProvider();

    expect(screen.getByTestId('language')).toHaveTextContent('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('falls back to Polish for an unsupported stored value', () => {
    window.localStorage.setItem('vitao-language', 'de');

    renderLanguageProvider();

    expect(screen.getByTestId('language')).toHaveTextContent('pl');
    expect(document.documentElement.lang).toBe('pl');
  });
});
