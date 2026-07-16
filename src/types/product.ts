export type ProductCategory =
  | 'Desk & Office'
  | 'Home Organization'
  | 'Cosmetic & Vanity'
  | 'Gaming & Display'
  | 'Custom Pieces'
  | 'Biurko i praca'
  | 'Organizacja domu'
  | 'Kosmetyki i toaletka'
  | 'Gaming i ekspozycja'
  | 'Projekty indywidualne';

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
  image: string;
  imageAlt: string;
  gallery?: string[];
  featured?: boolean;
};
