export type ProductCategory =
  | 'Desk & Office'
  | 'Home Organization'
  | 'Cosmetic & Vanity'
  | 'Gaming & Display'
  | 'Custom Pieces';

export type Product = {
  id: string;
  slug: string;
  name: string;
  category: ProductCategory;
  price: string;
  summary: string;
  description: string;
  dimensions: string;
  colors: string[];
  materials: string[];
  featured?: boolean;
};
