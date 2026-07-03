import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

type ButtonProps = {
  to: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
};

export function Button({ to, children, variant = 'primary' }: ButtonProps) {
  return <Link className={`button button--${variant}`} to={to}>{children}</Link>;
}
