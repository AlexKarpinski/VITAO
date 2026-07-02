import { NavLink, Link } from 'react-router-dom';

const links = [
  ['Home', '/'], ['Products', '/products'], ['Custom Order', '/custom'], ['About', '/about'], ['Contact + FAQ', '/contact'],
];
export function Header() {
  return <header className="site-header"><Link className="brand" to="/">VITAO</Link><nav>{links.map(([label,path])=><NavLink key={path} to={path} className={({isActive})=>isActive?'active':''}>{label}</NavLink>)}</nav></header>;
}
