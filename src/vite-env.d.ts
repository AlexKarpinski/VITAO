declare module 'react' {
  export type ReactNode = unknown;
  export type AnchorHTMLAttributes<T> = Record<string, unknown> & { className?: string; href?: string; children?: ReactNode };
  export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
  export function useState<T>(initial: T | (() => T)): [T, (value: T) => void];
  export const StrictMode: (props: { children?: ReactNode }) => unknown;
}

declare module 'react-dom/client' {
  export function createRoot(element: Element): { render(children: unknown): void };
}

declare namespace JSX {
  interface IntrinsicElements { [elementName: string]: Record<string, unknown>; }
}

declare module 'react/jsx-runtime' {
  export const jsx: unknown;
  export const jsxs: unknown;
  export const Fragment: unknown;
}

declare module '*.css';
