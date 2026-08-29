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

interface ParsedDestination {
  readonly href: string;
  readonly mode: "href" | "navigate" | "patch";
  readonly replace: boolean;
}

function parseDestination(
  href: unknown,
  navigate: unknown,
  patch: unknown,
  replace: unknown,
): ParsedDestination {
  const destinations = [href, patch, navigate].filter(
    (destination) => destination !== undefined,
  );
  if (
    destinations.length !== 1 ||
    typeof destinations[0] !== "string" ||
    destinations[0].length === 0
  ) {
    throw new TypeError(
      "Link requires exactly one non-empty href, patch, or navigate destination",
    );
  }

  if (href !== undefined) {
    if (replace !== undefined) {
      throw new TypeError("Link does not support replace with href");
    }
    return { href: href as string, mode: "href", replace: false };
  }

  if (replace !== undefined && typeof replace !== "boolean") {
    throw new TypeError("Link replace must be a boolean");
  }

  if (patch !== undefined) {
    return {
      href: patch as string,
      mode: "patch",
      replace: replace === true,
    };
  }

  return {
    href: navigate as string,
    mode: "navigate",
    replace: replace === true,
  };
}

export function Link(props: LinkProps): ReactElement {
  const { children, href, navigate, patch, replace, ...anchorAttributes } =
    props as AnchorProps & {
      readonly children?: ReactNode;
      readonly href?: unknown;
      readonly navigate?: unknown;
      readonly patch?: unknown;
      readonly replace?: unknown;
    };
  const destination = parseDestination(href, navigate, patch, replace);

  if (destination.mode === "href") {
    return (
      <a {...anchorAttributes} href={destination.href}>
        {children}
      </a>
    );
  }

  return (
    <a
      {...anchorAttributes}
      href={destination.href}
      data-phx-link={destination.mode === "patch" ? "patch" : "redirect"}
      data-phx-link-state={destination.replace ? "replace" : "push"}
    >
      {children}
    </a>
  );
}
