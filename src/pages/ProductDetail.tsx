import { Link, useParams } from 'react-router-dom';
import { findProductBySlug, products } from '../data/products';
import { ProductCard } from '../components/product/ProductCard';
import { Button } from '../components/ui/Button';
import { requestResponseTime } from '../data/customRequest';

export function ProductDetail() {
  const { slug } = useParams();
  const product = findProductBySlug(slug);

  if (!product) {
    return <section className="page-hero"><h1>Piece not found</h1><p>This product may have moved.</p><Link to="/products">Back to products</Link></section>;
  }

  const related = products.filter((item) => item.category === product.category && item.id !== product.id).slice(0, 3);
  const gallery = product.gallery?.length ? product.gallery : [product.image];
  const requestPath = `/custom?product=${encodeURIComponent(product.name)}`;

  return (
    <>
      <section className="detail">
        <div className="detail__gallery" aria-label={`${product.name} image gallery`}>
          <img className="detail__image" src={product.image} alt={product.imageAlt} />
          {gallery.length > 1 && (
            <div className="detail__thumbs">
              {gallery.map((image) => <img key={image} src={image} alt="" aria-hidden="true" />)}
            </div>
          )}
        </div>
        <div>
          <p className="eyebrow">{product.category}</p>
          <h1>{product.name}</h1>
          <p className="lead">{product.description}</p>
          <h2>{product.price}</h2>
          <div className="meta">
            <p><strong>Dimensions</strong>{product.dimensions}</p>
            <p><strong>Colors</strong>{product.colors.join(', ')}</p>
            <p><strong>Materials</strong>{product.materials.join(', ')}</p>
          </div>
          <div className="actions"><Button to={requestPath}>Ask about this piece</Button><Button to={requestPath} variant="secondary">Customise it</Button></div>
          <p className="response-note">{requestResponseTime}</p>
        </div>
      </section>
      {related.length > 0 && <section className="section"><p className="eyebrow">Related</p><h2>Similar pieces</h2><div className="product-grid">{related.map((item) => <ProductCard key={item.id} product={item} />)}</div></section>}
    </>
  );
}
