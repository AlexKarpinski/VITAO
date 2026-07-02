import { useEffect, useState } from 'react';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { About } from './pages/About';
import { Contact } from './pages/Contact';
import { CustomOrder } from './pages/CustomOrder';
import { Home } from './pages/Home';
import { ProductDetail } from './pages/ProductDetail';
import { Products } from './pages/Products';

function useHashRoute() {
  const [route, setRoute] = useState(() => window.location.hash.replace('#', '') || '/');
  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash.replace('#', '') || '/');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return route;
}

export function App() {
  const route = useHashRoute();
  const productMatch = route.match(/^\/products\/(.+)$/);
  let page = <Home />;
  if (route === '/products') page = <Products />;
  if (productMatch) page = <ProductDetail slug={productMatch[1]} />;
  if (route === '/custom') page = <CustomOrder />;
  if (route === '/about') page = <About />;
  if (route === '/contact') page = <Contact />;

  return <><Header /><main>{page}</main><Footer /></>;
}
