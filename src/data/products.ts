import ridgeTrayImage from '../assets/products/ridge-tray.svg';
import flowPenCupImage from '../assets/products/flow-pen-cup.svg';
import modularDeskOrganizerImage from '../assets/products/modular-desk-organizer.svg';
import duneCosmeticOrganizerImage from '../assets/products/dune-cosmetic-organizer.svg';
import arcControllerStandImage from '../assets/products/arc-controller-stand.svg';
import elevateHeadsetStandImage from '../assets/products/elevate-headset-stand.svg';
import waveCatchAllDishImage from '../assets/products/wave-catch-all-dish.svg';
import customFitObjectImage from '../assets/products/custom-fit-object.svg';
import type { Product } from '../types/product';

export const products: Product[] = [
  {
    id: 'ridge-tray',
    slug: 'ridge-tray',
    name: 'Ridge Tray',
    category: 'Desk & Office',
    price: 'From 49 zł',
    summary: 'A low-profile tray for the small essentials that collect on desks and entry tables.',
    description:
      'Ridge Tray gathers keys, earbuds, cards, and daily objects into one quiet place. The softly ribbed base adds texture without visual noise, while the matte finish keeps the piece calm and refined.',
    dimensions: '18 × 10 × 2 cm',
    colors: ['Warm ivory', 'Stone', 'Graphite'],
    materials: ['Matte PLA', 'Refined hand-finished edges'],
    image: ridgeTrayImage,
    imageAlt: 'Ridge Tray styled with a watch, keys, a pen, and small jewelry on a warm neutral surface.',
    gallery: [ridgeTrayImage],
    featured: true,
  },
  {
    id: 'flow-pen-cup',
    slug: 'flow-pen-cup',
    name: 'Flow Pen Cup',
    category: 'Desk & Office',
    price: 'From 35 zł',
    summary: 'A sculptural pen cup with a soft profile for a calmer workspace.',
    description:
      'Flow Pen Cup keeps pens, brushes, and small tools upright without feeling like office clutter. Its rounded profile brings a gentle studio object quality to everyday organization.',
    dimensions: '8 × 8 × 10 cm',
    colors: ['Ivory', 'Olive', 'Taupe'],
    materials: ['Matte PLA'],
    image: flowPenCupImage,
    imageAlt: 'Ribbed Flow Pen Cup holding pens and scissors in a warm minimal desk scene.',
    gallery: [flowPenCupImage],
    featured: true,
  },
  {
    id: 'modular-desk-organizer',
    slug: 'modular-desk-organizer',
    name: 'Modular Desk Organizer',
    category: 'Desk & Office',
    price: 'From 89 zł',
    summary: 'A multi-compartment organizer for stationery, notes, cables, and desk tools.',
    description:
      'Modular Desk Organizer creates a considered home for the loose pieces of a workspace. Compartments can be adjusted for stationery, small tech, or daily planning tools.',
    dimensions: '24 × 16 × 5 cm',
    colors: ['Warm ivory', 'Stone', 'Olive'],
    materials: ['Matte PLA', 'Made-to-order compartment layout'],
    image: modularDeskOrganizerImage,
    imageAlt: 'Multi-compartment Modular Desk Organizer with stationery and small desk tools arranged inside.',
    gallery: [modularDeskOrganizerImage],
  },
  {
    id: 'dune-cosmetic-organizer',
    slug: 'dune-cosmetic-organizer',
    name: 'Dune Cosmetic Organizer',
    category: 'Cosmetic & Vanity',
    price: 'From 79 zł',
    summary: 'A refined vanity organizer for skincare, samples, and daily beauty tools.',
    description:
      'Dune Cosmetic Organizer uses staggered compartments to make bottles, brushes, and small tools easy to see and arrange. It is sized for vanity corners and bathroom shelves that need order without heaviness.',
    dimensions: '22 × 12 × 5 cm',
    colors: ['Sand', 'Warm ivory', 'Clay'],
    materials: ['Matte PLA', 'Made-to-order sizing available'],
    image: duneCosmeticOrganizerImage,
    imageAlt: 'Dune Cosmetic Organizer styled with skincare bottles and a brush on a neutral vanity surface.',
    gallery: [duneCosmeticOrganizerImage],
    featured: true,
  },
  {
    id: 'arc-controller-stand',
    slug: 'arc-controller-stand',
    name: 'Arc Controller Stand',
    category: 'Gaming & Display',
    price: 'From 59 zł',
    summary: 'A minimal display stand for controllers, handhelds, and small devices.',
    description:
      'Arc Controller Stand gives gaming accessories a considered place when they are not in use. The angled rest is stable and compact, designed to look at home on a shelf, desk, or media console.',
    dimensions: '12 × 10 × 8 cm',
    colors: ['Graphite', 'Stone', 'Olive'],
    materials: ['Matte PLA', 'Optional felt base'],
    image: arcControllerStandImage,
    imageAlt: 'Arc Controller Stand displaying a game controller in a warm minimal media setup.',
    gallery: [arcControllerStandImage],
  },
  {
    id: 'elevate-headset-stand',
    slug: 'elevate-headset-stand',
    name: 'Elevate Headset Stand',
    category: 'Gaming & Display',
    price: 'From 99 zł',
    summary: 'A balanced stand that keeps a headset displayed neatly between sessions.',
    description:
      'Elevate Headset Stand brings order to a gaming or work setup without adding visual weight. The broad base and soft vertical form keep the headset easy to reach and display.',
    dimensions: '18 × 14 × 25 cm',
    colors: ['Graphite', 'Stone', 'Warm ivory'],
    materials: ['Matte PLA', 'Optional felt base'],
    image: elevateHeadsetStandImage,
    imageAlt: 'Elevate Headset Stand holding a headset on a calm neutral desk surface.',
    gallery: [elevateHeadsetStandImage],
  },
  {
    id: 'wave-catch-all-dish',
    slug: 'wave-catch-all-dish',
    name: 'Wave Catch-All Dish',
    category: 'Home Organization',
    price: 'From 39 zł',
    summary: 'A soft-edged dish for jewelry, coins, bedside items, and daily rituals.',
    description:
      'Wave Catch-All Dish creates a small landing place for the objects you reach for every day. Its softened edge and shallow form make it useful on a nightstand, shelf, or entry surface.',
    dimensions: '14 × 14 × 3 cm',
    colors: ['Ivory', 'Sand', 'Clay'],
    materials: ['Matte PLA'],
    image: waveCatchAllDishImage,
    imageAlt: 'Wave Catch-All Dish holding jewelry and keys on a warm bedside-style surface.',
    gallery: [waveCatchAllDishImage],
  },
  {
    id: 'custom-fit-object',
    slug: 'custom-fit-object',
    name: 'Custom Fit Object',
    category: 'Custom Pieces',
    price: 'Quotes from 89 zł',
    summary: 'A made-to-order piece designed around your object, shelf, setup, or routine.',
    description:
      'Share the object, measurements, and space you want to improve. VITAO will shape a practical, refined piece around your use case and confirm the quote before production begins.',
    dimensions: 'Made to fit',
    colors: ['Warm neutrals', 'Graphite', 'Selected custom colors'],
    materials: ['Material selected by use case'],
    image: customFitObjectImage,
    imageAlt: 'Custom Fit Object concept shown as a neutral studio detail for a made-to-order VITAO piece.',
    gallery: [customFitObjectImage],
  },
];

export const featuredProducts = products.filter((product) => product.featured);
export const findProductBySlug = (slug: string | undefined) => products.find((product) => product.slug === slug);
