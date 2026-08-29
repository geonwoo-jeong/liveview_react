import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createSlotBindings } from "./slots";

describe("slot bindings", () => {
  it("maps the default slot to keyed React children", () => {
    const { children } = createSlotBindings(
      { default: "<strong>Default</strong>" },
      {},
      "test slots",
    );

    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ key: "default" });
    expect(renderToStaticMarkup(children[0])).toBe(
      '<div data-liveview-react-slot="default"><strong>Default</strong></div>',
    );
  });

  it("maps each named slot to a same-name ReactNode prop", () => {
    const { props } = createSlotBindings(
      {
        default: "<p>Default</p>",
        footer: "<small>Footer</small>",
        sidePanel: "<aside>Side</aside>",
      },
      {},
      "test slots",
    );

    expect(props).not.toHaveProperty("default");
    expect(props).not.toHaveProperty("children");
    const footer = props.footer;
    const sidePanel = props.sidePanel;
    expect(isValidElement(footer)).toBe(true);
    expect(isValidElement(sidePanel)).toBe(true);
    if (!isValidElement(footer) || !isValidElement(sidePanel)) {
      throw new Error("Expected named slots to be React elements");
    }
    expect(renderToStaticMarkup(footer)).toBe(
      '<div data-liveview-react-slot="footer"><small>Footer</small></div>',
    );
    expect(renderToStaticMarkup(sidePanel)).toContain("Side");
  });

  it.each([
    ["default", { children: "ordinary" }],
    ["footer", { footer: "ordinary" }],
  ])("rejects a %s slot collision", (slotName, props) => {
    expect(() =>
      createSlotBindings({ [slotName]: "content" }, props, "test"),
    ).toThrow(`prop "${slotName === "default" ? "children" : slotName}"`);
  });

  it.each(["children", "Uppercase", "kebab-case", "two words"])(
    'rejects the invalid or reserved slot name "%s"',
    (slotName) => {
      expect(() =>
        createSlotBindings({ [slotName]: "content" }, {}, "test"),
      ).toThrow();
    },
  );

  it.each([
    ["forms", "<form/><form><button>Save</button></form>"],
    ["Phoenix hooks", '<div phx-hook="Nested"></div>'],
    ["Phoenix-managed bindings", '<button phx-click="save">Save</button>'],
    ["Phoenix-managed bindings", '<div data-phx-component="1"></div>'],
    ["nested React roots", "<div data-react-target></div>"],
    ["nested React roots", '<div data-liveview-react-version="1"></div>'],
  ])("rejects unsupported %s", (reason, html) => {
    expect(() =>
      createSlotBindings({ default: html }, {}, "test slots"),
    ).toThrow(`unsupported ${reason}`);
  });

  it("preserves already-escaped inert HTML without interpreting it as markup", () => {
    const {
      children: [child],
    } = createSlotBindings(
      { default: "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;" },
      {},
      "test slots",
    );

    expect(renderToStaticMarkup(child)).toContain(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );

    expect(() =>
      createSlotBindings(
        {
          default: 'text phx-click="save" &lt;button phx-click="save"&gt;',
        },
        {},
        "test slots",
      ),
    ).not.toThrow();
  });
});
