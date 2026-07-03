export type CustomRequestContext = {
  name: string;
  email: string;
  productName: string;
  dimensions: string;
  color: string;
  quantity: string;
  deliveryCity: string;
  notes: string;
};

export const requestResponseTime = 'We usually reply within 1–2 business days with questions, next steps, or a starting quote.';

export const buildCustomRequestEmail = (request: CustomRequestContext) => {
  const subjectProduct = request.productName.trim() || 'custom piece';
  const sender = request.name.trim() || 'a visitor';
  const subject = `VITAO request: ${subjectProduct} from ${sender}`;
  const body = [
    `Name: ${request.name}`,
    `Email: ${request.email}`,
    '',
    'Request context:',
    `Product / idea: ${request.productName}`,
    `Dimensions: ${request.dimensions}`,
    `Preferred color: ${request.color}`,
    `Quantity: ${request.quantity}`,
    `Delivery city: ${request.deliveryCity}`,
    '',
    'Notes:',
    request.notes,
  ].join('\n');

  return { subject, body };
};
