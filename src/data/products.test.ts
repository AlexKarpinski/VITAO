import { describe, expect, it } from 'vitest';
import { featuredProducts, findProductBySlug, products } from './products';

describe('product helpers', () => {
  it('derives featured products from products marked as featured', () => {
    const expectedFeatured = products.filter((product) => product.featured);

    expect(featuredProducts).toEqual(expectedFeatured);
    expect(featuredProducts.length).toBeGreaterThan(0);
  });

  it('finds products by slug and returns undefined for unknown slugs', () => {
    expect(findProductBySlug('ridge-tray')?.name).toBe('Ridge Tray');
    expect(findProductBySlug('not-a-product')).toBeUndefined();
    expect(findProductBySlug(undefined)).toBeUndefined();
  });
});
