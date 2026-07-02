import type { Product, ProductCategory } from '../types/product';

export const categories: ProductCategory[] = [
  'Desk & Office',
  'Home Organization',
  'Cosmetic & Vanity',
  'Gaming & Display',
  'Custom Pieces',
];

export const products: Product[] = [
  { slug: 'ridge-tray', name: 'Ridge Tray', category: 'Desk & Office', price: 'From 39 zł', summary: 'A low-profile desk tray for keys, notes, and everyday carry.', description: 'A calm catch point for small essentials with a subtle ridged base that keeps objects visible and ordered.', dimensions: '18 × 10 × 2 cm', materials: ['Matte PLA blend', 'Soft cork feet'], colors: ['Ivory', 'Stone', 'Graphite'], featured: true },
  { slug: 'flow-pen-cup', name: 'Flow Pen Cup', category: 'Desk & Office', price: 'From 29 zł', summary: 'A sculptural pen cup with a gently waved profile.', description: 'Designed for desks and studios, Flow keeps writing tools upright while adding a soft vertical accent.', dimensions: '8 × 8 × 10 cm', materials: ['Matte PLA blend'], colors: ['Sand', 'Olive', 'Graphite'], featured: true },
  { slug: 'dune-cosmetic-organizer', name: 'Dune Cosmetic Organizer', category: 'Cosmetic & Vanity', price: 'From 59 zł', summary: 'Tiered storage for daily cosmetics and small vanity pieces.', description: 'A refined organizer with practical compartments for brushes, tubes, and daily-use skincare.', dimensions: '22 × 12 × 8 cm', materials: ['Matte PLA blend'], colors: ['Ivory', 'Clay', 'Stone'], featured: true },
  { slug: 'arc-controller-stand', name: 'Arc Controller Stand', category: 'Gaming & Display', price: 'From 49 zł', summary: 'A minimal display stand for controllers and handheld accessories.', description: 'A quiet alternative to tech-heavy gaming accessories, shaped to present your setup cleanly.', dimensions: '12 × 9 × 11 cm', materials: ['Matte PLA blend', 'Protective felt pads'], colors: ['Graphite', 'Olive', 'Stone'] },
  { slug: 'wave-catch-all-dish', name: 'Wave Catch-All Dish', category: 'Home Organization', price: 'From 35 zł', summary: 'A soft-edged dish for entry tables, shelves, and bedside surfaces.', description: 'A small home for jewelry, coins, keys, or the pieces that usually drift across a room.', dimensions: '16 × 16 × 3 cm', materials: ['Matte PLA blend'], colors: ['Ivory', 'Sand', 'Clay'] },
  { slug: 'made-to-fit-object', name: 'Made-to-Fit Object', category: 'Custom Pieces', price: 'Custom quote', summary: 'A tailored object designed around your measurements, use case, and space.', description: 'Share a photo, sketch, or dimensions. VITAO will shape a functional object around the way you live or work.', dimensions: 'Made to order', materials: ['Matte PLA blend', 'Special finishes on request'], colors: ['Palette matched to your space'], featured: true },
];

export const featuredProducts = products.filter((product) => product.featured);

export function getProductBySlug(slug: string) {
  return products.find((product) => product.slug === slug);
}
