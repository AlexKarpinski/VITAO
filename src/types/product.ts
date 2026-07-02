export type ProductCategory = 'Desk & Office' | 'Home Organization' | 'Cosmetic & Vanity' | 'Gaming & Display' | 'Custom Pieces';

export type Product = {
  slug: string;
  name: string;
  category: ProductCategory;
  price: string;
  summary: string;
  description: string;
  dimensions: string;
  materials: string[];
  colors: string[];
  featured?: boolean;
};
