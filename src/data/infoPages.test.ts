import { describe, expect, it } from 'vitest';
import { getInfoPageBySlug, infoPages } from './infoPages';

describe('info pages', () => {
  it('keeps legal and order pages addressable by slug', () => {
    expect(infoPages.map((page) => page.slug)).toEqual(['order-info', 'privacy', 'terms']);
    expect(getInfoPageBySlug('order-info')?.title).toContain('made-to-order');
  });

  it('returns undefined for unknown information pages', () => {
    expect(getInfoPageBySlug('shipping')).toBeUndefined();
  });
});
