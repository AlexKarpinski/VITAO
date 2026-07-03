import { createHashRouter, RouterProvider } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { Home } from './pages/Home';
import { Products } from './pages/Products';
import { ProductDetail } from './pages/ProductDetail';
import { CustomOrder } from './pages/CustomOrder';
import { About } from './pages/About';
import { Contact } from './pages/Contact';

const router = createHashRouter([
  { path: '/', element: <Layout />, children: [
    { index: true, element: <Home /> },
    { path: 'products', element: <Products /> },
    { path: 'products/:slug', element: <ProductDetail /> },
    { path: 'custom', element: <CustomOrder /> },
    { path: 'about', element: <About /> },
    { path: 'contact', element: <Contact /> },
  ]},
]);

export function App() { return <RouterProvider router={router} />; }
