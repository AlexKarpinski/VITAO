import { describe, expect, it } from 'vitest';
import { getInfoPageBySlug, getInfoPages } from './infoPages';

describe('info pages', () => {
  it('keeps legal and order pages addressable by slug in both languages', () => {
    expect(getInfoPages('pl').map((page) => page.slug)).toEqual(['order-info', 'privacy', 'terms']);
    expect(getInfoPages('en').map((page) => page.slug)).toEqual(['order-info', 'privacy', 'terms']);
    expect(getInfoPageBySlug('order-info', 'pl')?.title).toContain('wycenę');
    expect(getInfoPageBySlug('order-info', 'en')?.title).toContain('quote');
  });

  it('returns undefined for unknown information pages', () => {
    expect(getInfoPageBySlug('shipping', 'pl')).toBeUndefined();
    expect(getInfoPageBySlug('shipping', 'en')).toBeUndefined();
  });
});
