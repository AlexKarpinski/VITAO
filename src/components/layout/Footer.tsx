import { Link } from 'react-router-dom';

const footerLinks = [
  ['Order information', '/info/order-info'],
  ['Privacy', '/info/privacy'],
  ['Terms', '/info/terms'],
];

export function Footer() {
  return (
    <footer className="site-footer">
      <div>
        <strong>VITAO</strong>
        <p>Custom objects for calm, modern spaces.</p>
      </div>
      <div>
        <p>Made to order • Warm minimal • Small studio</p>
        <a href="mailto:hello@vitao.studio">hello@vitao.studio</a>
      </div>
      <nav className="footer-links" aria-label="Legal and order information">
        {footerLinks.map(([label, path]) => <Link key={path} to={path}>{label}</Link>)}
      </nav>
    </footer>
  );
}
