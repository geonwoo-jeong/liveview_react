import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Link } from "./link";

function renderLink(props) {
  return renderToStaticMarkup(
    React.createElement(Link, props, props.children ?? "Link"),
  );
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
    const anchor = new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector("a");
    expect(anchor.hasAttribute("download")).toBe(true);
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
});
