import type { AnchorHTMLAttributes, ReactElement, ReactNode } from "react";

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">;

interface BrowserLinkProps extends AnchorProps {
  readonly href: string;
  readonly navigate?: never;
  readonly patch?: never;
  readonly replace?: never;
}

interface PatchLinkProps extends AnchorProps {
  readonly href?: never;
  readonly navigate?: never;
  readonly patch: string;
  readonly replace?: boolean;
}

interface NavigateLinkProps extends AnchorProps {
  readonly href?: never;
  readonly navigate: string;
  readonly patch?: never;
  readonly replace?: boolean;
}

export type LinkProps = BrowserLinkProps | PatchLinkProps | NavigateLinkProps;

export function Link(props: LinkProps): ReactElement {
  const { children, href, navigate, patch, replace, ...anchorAttributes } =
    props as AnchorProps & {
      readonly children?: ReactNode;
      readonly href?: unknown;
      readonly navigate?: unknown;
      readonly patch?: unknown;
      readonly replace?: unknown;
    };
  const destinations = [href, patch, navigate].filter(
    (destination) => destination !== undefined,
  );

  if (
    destinations.length !== 1 ||
    typeof destinations[0] !== "string" ||
    destinations[0].length === 0 ||
    (href !== undefined && replace !== undefined)
  ) {
    throw new TypeError(
      "Link requires exactly one non-empty href, patch, or navigate destination",
    );
  }

  if (typeof href === "string") {
    return (
      <a {...anchorAttributes} href={href}>
        {children}
      </a>
    );
  }

  if (typeof patch === "string") {
    return (
      <a
        {...anchorAttributes}
        href={patch}
        data-phx-link="patch"
        data-phx-link-state={replace === true ? "replace" : "push"}
      >
        {children}
      </a>
    );
  }

  if (typeof navigate === "string") {
    return (
      <a
        {...anchorAttributes}
        href={navigate}
        data-phx-link="redirect"
        data-phx-link-state={replace === true ? "replace" : "push"}
      >
        {children}
      </a>
    );
  }

  throw new TypeError(
    "Link requires exactly one non-empty href, patch, or navigate destination",
  );
}
