import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { featuredProducts, findProductBySlug, products } from './products';

const productImagePattern = /^\/?(?:VITAO\/)?images\/products\/.+\.(jpe?g|png|webp)$/;

const publicPathFromImageUrl = (imageUrl: string) => {
  const normalizedPath = imageUrl.replace(/^\/?(?:VITAO\/)?/, '');
  return join(process.cwd(), 'public', normalizedPath);
};

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

  it('provides accessible local image metadata for every product', () => {
    products.forEach((product) => {
      expect(product.image).toMatch(productImagePattern);
      expect(existsSync(publicPathFromImageUrl(product.image))).toBe(true);
      expect(product.imageAlt.trim().length).toBeGreaterThan(20);
      expect(product.imageAlt.toLowerCase()).toContain(product.name.toLowerCase().split(' ')[0]);
      product.gallery?.forEach((image) => {
        expect(image).toMatch(productImagePattern);
        expect(existsSync(publicPathFromImageUrl(image))).toBe(true);
      });
    });
  });
});
