import { mkdir, rm, readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
let html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
html = html.replace('<script type="module" src="/src/main.tsx"></script>', '<script type="module" src="./assets/main.js"></script>');
await writeFile(new URL('index.html', dist), html);
await mkdir(new URL('assets/', dist));
const css = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');
await writeFile(new URL('assets/main.css', dist), css.replace(/@import[^;]+;\n\n/, ''));
const productsText = await readFile(new URL('../src/data/products.ts', import.meta.url), 'utf8');
const js = `import './main.css';\nconst root=document.getElementById('root');\nroot.innerHTML=\`${String.raw`<header class="site-header"><a class="brand" href="#/">VITAO</a><nav><a href="#/products">Products</a><a href="#/custom">Custom Order</a><a href="#/about">About</a><a href="#/contact">Contact</a></nav></header><main><section class="hero"><div><p class="section-label">Small studio objects</p><h1>Custom printed objects for modern spaces.</h1><p>VITAO creates functional, refined pieces for desks, homes, vanity routines, and considered setups.</p><div class="hero__actions"><a class="button button--primary" href="#/products">Browse products</a><a class="button button--secondary" href="#/custom">Start a custom order</a></div></div><div class="hero__visual"><span>Ridge Tray / Stone Matte</span></div></section><section class="section"><p class="section-label">MVP pages</p><div class="section__heading"><h2>Static VITAO foundation is ready.</h2><p>Run the React/Vite development server after installing dependencies to browse all hash routes and product detail pages.</p></div><div class="feature-grid"><article><h3>Home</h3><p>Premium landing page sections.</p></article><article><h3>Products</h3><p>Typed static catalog data.</p></article><article><h3>Custom Orders</h3><p>Lead-focused inquiry path.</p></article></div></section></main><footer class="site-footer"><div><a class="brand" href="#/">VITAO</a><p>Custom printed objects for modern spaces.</p></div><div><p>hello@vitao.studio</p><p>@vitao.studio</p></div></footer>`}\`;\nconsole.log('VITAO static build generated with product data source length:', ${productsText.length});\n`;
await writeFile(new URL('assets/main.js', dist), js);
if (existsSync(new URL('../public', import.meta.url))) await copyFile(new URL('../public', import.meta.url), new URL('public', dist));
console.log('Built dist/ for GitHub Pages preview.');
