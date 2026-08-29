import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Link, type LinkProps } from "./link";

function renderLink(props: LinkProps) {
  return renderToStaticMarkup(
    createElement(Link, props, props.children ?? "Link"),
  );
}

function parseAnchor(html: string): HTMLAnchorElement {
  const anchor = new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector("a");
  if (!anchor) {
    throw new Error("Expected rendered markup to contain an anchor");
  }

  return anchor;
}

describe("Link", () => {
  it("renders a normal href without LiveView navigation attributes", () => {
    const html = renderLink({ href: "/logout", children: "Logout" });

    expect(html).toContain('href="/logout"');
    expect(html).not.toContain("data-phx-link");
  });

  it("preserves standard anchor attributes for an external href", () => {
    const html = renderLink({
      href: "https://example.com/report.pdf",
      target: "_blank",
      rel: "noreferrer",
      download: true,
      children: "Report",
    });

    expect(html).toContain('href="https://example.com/report.pdf"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(parseAnchor(html).hasAttribute("download")).toBe(true);
    expect(html).not.toContain("data-phx-link");
  });

  it("maps patch navigation to LiveView declarative attributes", () => {
    const html = renderLink({ patch: "/users?page=2", children: "Next" });

    expect(html).toContain('href="/users?page=2"');
    expect(html).toContain('data-phx-link="patch"');
    expect(html).toContain('data-phx-link-state="push"');
  });

  it("maps navigate navigation to a LiveView redirect", () => {
    const html = renderLink({ navigate: "/settings", children: "Settings" });

    expect(html).toContain('href="/settings"');
    expect(html).toContain('data-phx-link="redirect"');
    expect(html).toContain('data-phx-link-state="push"');
  });

  it("maps replace to replacement history state", () => {
    const html = renderLink({
      patch: "/users?page=1",
      replace: true,
      children: "Previous",
    });

    expect(html).toContain('data-phx-link-state="replace"');
  });

  it("preserves native target, download, rel, and consumer click handling", () => {
    const onClick = vi.fn();
    const element = Link({
      patch: "/report.pdf",
      target: "_blank",
      download: "report.pdf",
      rel: "noreferrer",
      onClick,
      children: "Report",
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('target="_blank"');
    expect(html).toContain('download="report.pdf"');
    expect(html).toContain('rel="noreferrer"');
    expect(
      (element as ReactElement<{ readonly onClick?: unknown }>).props.onClick,
    ).toBe(onClick);
  });

  it("rejects a missing destination at runtime", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(Link, {} as ComponentProps<typeof Link>),
      ),
    ).toThrow(
      "Link requires exactly one non-empty href, patch, or navigate destination",
    );
  });

  it("rejects conflicting destinations at runtime", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(Link, { href: "/one", patch: "/two" } as never),
      ),
    ).toThrow(
      "Link requires exactly one non-empty href, patch, or navigate destination",
    );
  });

  it("rejects history replacement for a browser href", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(Link, { href: "/logout", replace: true } as never),
      ),
    ).toThrow("Link does not support replace with href");
  });
});
