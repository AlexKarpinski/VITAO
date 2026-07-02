const links = [
  ['Products', '#/products'],
  ['Custom Order', '#/custom'],
  ['About', '#/about'],
  ['Contact', '#/contact'],
];

export function Header() {
  return <header className="site-header"><a className="brand" href="#/">VITAO</a><nav>{links.map(([label, href]) => <a key={href} href={href}>{label}</a>)}</nav></header>;
}
