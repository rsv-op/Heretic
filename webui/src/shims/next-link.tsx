import type { AnchorHTMLAttributes, ReactNode } from "react";

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children?: ReactNode;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

export default function Link({ href, children, prefetch: _p, replace: _r, scroll: _s, ...rest }: LinkProps) {
  const isExternal = /^(https?:|mailto:|tel:)/.test(href);
  const target = isExternal || href.startsWith("#") ? href : `#${href}`;
  return (
    <a {...rest} href={target}>
      {children}
    </a>
  );
}
