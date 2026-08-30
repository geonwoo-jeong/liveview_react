import type { ComponentProps, SlotMap } from "../types";

const SLOT_NAME = /^[a-z][A-Za-z0-9_]*$/;
const SLOT_TAG_NAME = /^([A-Za-z][A-Za-z0-9:-]*)/;
const SLOT_ATTRIBUTE_NAME = /^([^\t\n\f\r />=<"'`\0]+)/;
const HTML_WHITESPACE_ONLY = /^[\t\n\f\r ]*$/;
const SAFE_SLOT_TAGS: ReadonlySet<string> = new Set([
  "abbr",
  "address",
  "article",
  "aside",
  "b",
  "bdi",
  "bdo",
  "blockquote",
  "br",
  "caption",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "i",
  "ins",
  "kbd",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "p",
  "pre",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "var",
  "wbr",
]);
const SAFE_SLOT_ATTRIBUTES: ReadonlySet<string> = new Set([
  "abbr",
  "class",
  "colspan",
  "datetime",
  "dir",
  "headers",
  "hidden",
  "id",
  "inert",
  "lang",
  "reversed",
  "role",
  "rowspan",
  "scope",
  "span",
  "start",
  "title",
  "translate",
  "type",
  "value",
]);
const URL_SLOT_ATTRIBUTES: ReadonlySet<string> = new Set([
  "action",
  "archive",
  "background",
  "cite",
  "classid",
  "codebase",
  "data",
  "formaction",
  "href",
  "icon",
  "itemid",
  "itemtype",
  "longdesc",
  "manifest",
  "ping",
  "poster",
  "profile",
  "src",
  "srcdoc",
  "srcset",
  "usemap",
  "xlink:href",
]);
const NESTED_ROOT_ATTRIBUTES: ReadonlySet<string> = new Set([
  "data-react-checksum",
  "data-react-hydration",
  "data-react-target",
  "data-reactid",
  "data-reactroot",
]);
const SAFE_PREFIXED_ATTRIBUTE = /^(?:aria|data)-[a-z0-9_.:-]+$/;
const UNSAFE_SLOT_NAMES: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

interface SlotMarkupScan {
  readonly next: number;
  readonly violation?: string;
}

function assertSlotName(slotName: string, source: string): void {
  if (slotName === "default") return;
  if (slotName === "children") {
    throw new TypeError(
      `${source} reserves slot "children" for the default slot`,
    );
  }
  if (UNSAFE_SLOT_NAMES.has(slotName)) {
    throw new TypeError(
      `${source} cannot transport prototype-sensitive slot "${slotName}"`,
    );
  }
  if (!SLOT_NAME.test(slotName)) {
    throw new TypeError(
      `${source} slot "${slotName}" must use lower camelCase or snake_case`,
    );
  }
}

function assertInertSlotHtml(
  slotName: string,
  html: string,
  source: string,
): void {
  const violation = findSlotMarkupViolation(html);
  if (violation) {
    throw new TypeError(
      `${source} slot "${slotName}" contains unsupported ${violation}`,
    );
  }
}

function findSlotMarkupViolation(html: string): string | undefined {
  let cursor = 0;

  while (cursor < html.length) {
    const openingBracket = html.indexOf("<", cursor);
    if (openingBracket === -1) return undefined;

    const scan = scanSlotMarkup(html, openingBracket + 1);
    if (scan.violation) return scan.violation;
    cursor = scan.next;
  }

  return undefined;
}

function scanSlotMarkup(html: string, cursor: number): SlotMarkupScan {
  if (html.startsWith("!--", cursor)) {
    return scanSlotComment(html, cursor + 3);
  }

  const first = html[cursor];
  if (first === "!") {
    return { next: html.length, violation: "markup declarations" };
  }
  if (first === "?") {
    return { next: html.length, violation: "processing instructions" };
  }
  if (first === "/") return scanClosingSlotTag(html, cursor + 1);
  if (first !== undefined && /[A-Za-z]/.test(first)) {
    return scanOpeningSlotTag(html, cursor);
  }

  return { next: cursor };
}

function scanSlotComment(html: string, cursor: number): SlotMarkupScan {
  const commentEnd = html.indexOf("-->", cursor);
  if (commentEnd === -1) {
    return { next: html.length, violation: "malformed HTML" };
  }

  const comment = html.slice(cursor, commentEnd);
  return isValidSlotComment(comment)
    ? { next: commentEnd + 3 }
    : { next: html.length, violation: "markup declarations" };
}

function isValidSlotComment(comment: string): boolean {
  return !(
    comment.startsWith(">") ||
    comment.startsWith("->") ||
    comment.includes("<!--") ||
    comment.includes("--!>") ||
    comment.endsWith("<!-")
  );
}

function scanOpeningSlotTag(html: string, cursor: number): SlotMarkupScan {
  const tag = readSlotToken(html, cursor, SLOT_TAG_NAME);
  if (!tag) return { next: html.length, violation: "malformed HTML" };

  const attributes = scanSlotAttributes(html, tag.next);
  if (attributes.violation) return attributes;

  const violation = slotTagViolation(tag.value.toLowerCase());
  if (violation) return { next: html.length, violation };
  return attributes;
}

function scanClosingSlotTag(html: string, cursor: number): SlotMarkupScan {
  const tag = readSlotToken(html, cursor, SLOT_TAG_NAME);
  if (!tag) return { next: html.length, violation: "malformed HTML" };

  const violation = slotTagViolation(tag.value.toLowerCase());
  if (violation) return { next: html.length, violation };

  const closingBracket = skipHtmlWhitespace(html, tag.next);
  return html[closingBracket] === ">"
    ? { next: closingBracket + 1 }
    : { next: html.length, violation: "malformed HTML" };
}

function scanSlotAttributes(html: string, cursor: number): SlotMarkupScan {
  const next = skipHtmlWhitespace(html, cursor);
  if (html[next] === ">") return { next: next + 1 };
  if (html[next] === "/" && html[next + 1] === ">") {
    return { next: next + 2 };
  }
  if (html[next] === undefined || html[next] === "/") {
    return { next: html.length, violation: "malformed HTML" };
  }

  const attribute = readSlotToken(html, next, SLOT_ATTRIBUTE_NAME);
  if (!attribute) return { next: html.length, violation: "malformed HTML" };

  const violation = slotAttributeViolation(attribute.value.toLowerCase());
  if (violation) return { next: html.length, violation };

  const value = consumeSlotAttributeValue(html, attribute.next);
  return value.violation ? value : scanSlotAttributes(html, value.next);
}

function readSlotToken(
  html: string,
  cursor: number,
  pattern: RegExp,
): { readonly next: number; readonly value: string } | undefined {
  const match = pattern.exec(html.slice(cursor));
  if (!match?.[1]) return undefined;
  return { next: cursor + match[0].length, value: match[1] };
}

function slotTagViolation(tagName: string): string | undefined {
  if (tagName === "form") return "forms";
  return SAFE_SLOT_TAGS.has(tagName)
    ? undefined
    : "active or resource-bearing markup";
}

function slotAttributeViolation(name: string): string | undefined {
  if (name === "phx-hook") return "Phoenix hooks";
  if (name.startsWith("phx-") || name.startsWith("data-phx-")) {
    return "Phoenix-managed bindings";
  }
  if (
    NESTED_ROOT_ATTRIBUTES.has(name) ||
    name.startsWith("data-liveview-react-")
  ) {
    return "nested React roots";
  }
  if (name.startsWith("on")) return "event handler attributes";
  if (name === "style") return "style attributes";
  if (URL_SLOT_ATTRIBUTES.has(name)) return "URL-bearing attributes";
  if (SAFE_SLOT_ATTRIBUTES.has(name) || SAFE_PREFIXED_ATTRIBUTE.test(name)) {
    return undefined;
  }
  return `non-inert attribute "${name}"`;
}

function consumeSlotAttributeValue(
  html: string,
  cursor: number,
): SlotMarkupScan {
  const next = skipHtmlWhitespace(html, cursor);
  if (html[next] !== "=") return { next };

  const valueStart = skipHtmlWhitespace(html, next + 1);
  const quote = html[valueStart];
  if (quote === '"' || quote === "'") {
    const valueEnd = html.indexOf(quote, valueStart + 1);
    return valueEnd === -1
      ? { next: html.length, violation: "malformed HTML" }
      : { next: valueEnd + 1 };
  }
  return consumeUnquotedSlotAttributeValue(html, valueStart);
}

function consumeUnquotedSlotAttributeValue(
  html: string,
  cursor: number,
): SlotMarkupScan {
  let next = cursor;
  while (next < html.length) {
    const character = html[next];
    if (
      character === undefined ||
      isHtmlWhitespace(character) ||
      character === ">"
    ) {
      break;
    }

    if (/["'`=<]/.test(character)) {
      return { next: html.length, violation: "malformed HTML" };
    }

    next += 1;
  }
  return next === cursor
    ? { next: html.length, violation: "malformed HTML" }
    : { next };
}

function skipHtmlWhitespace(html: string, cursor: number): number {
  let next = cursor;
  while (next < html.length && isHtmlWhitespace(html[next])) next += 1;
  return next;
}

function isHtmlWhitespace(character: string | undefined): boolean {
  return character !== undefined && /[\t\n\f\r ]/.test(character);
}

export function isEmptySlotHtml(html: string): boolean {
  return HTML_WHITESPACE_ONLY.test(html);
}

export function slotPropName(slotName: string): string {
  return slotName === "default" ? "children" : slotName;
}

function validateSlots(slots: SlotMap, source: string): void {
  for (const [slotName, html] of Object.entries(slots)) {
    assertSlotName(slotName, source);
    assertInertSlotHtml(slotName, html, source);
  }
}

export function validateSlotBindings(
  slots: SlotMap,
  props: ComponentProps,
  source: string,
): void {
  validateSlots(slots, source);

  for (const [slotName, html] of Object.entries(slots)) {
    if (isEmptySlotHtml(html)) continue;
    const propName = slotPropName(slotName);
    if (Object.hasOwn(props, propName)) {
      throw new TypeError(
        `${source} cannot define both prop "${propName}" and slot "${slotName}"`,
      );
    }
  }
}
