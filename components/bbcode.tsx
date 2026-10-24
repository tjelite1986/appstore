import { Fragment } from "react";

/**
 * A mod description as Nexus writes it: BBCode, with `<br />` for line breaks
 * and HTML entities in the text.
 *
 * Drawn as React elements, never as HTML — the text is somebody else's, and a
 * tag this does not know is dropped while its contents stay. Links keep only
 * http(s) targets. `[img]` and `[youtube]` are dropped whole: the page's CSP
 * would refuse the image anyway, and an empty frame says less than nothing.
 * Server-safe, no state.
 */

type Node = string | { tag: string; arg: string; children: Node[] };

const DROPPED = new Set(["img", "youtube", "video"]);
const TAG = /\[(\/?)([a-z*]+)(?:=([^\]]*))?\]/gi;

function decode(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

function parse(source: string): Node[] {
  const text = source
    .replace(/\r/g, "")
    .replace(/\n?<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    // Nexus pads its sections with runs of empty lines; one is a paragraph.
    .replace(/\n{3,}/g, "\n\n");
  const root: Node[] = [];
  const stack: { tag: string; arg: string; children: Node[] }[] = [];
  const out = () => (stack.length ? stack[stack.length - 1].children : root);
  let last = 0;

  for (const m of text.matchAll(TAG)) {
    const [whole, closing, rawTag, arg = ""] = m;
    const tag = rawTag.toLowerCase();
    if (m.index! > last) out().push(decode(text.slice(last, m.index)));
    last = m.index! + whole.length;

    if (tag === "*") {
      // A list item runs until the next one or the end of its list.
      if (stack.length && stack[stack.length - 1].tag === "*") stack.pop();
      const item = { tag: "*", arg: "", children: [] };
      out().push(item);
      stack.push(item);
    } else if (closing) {
      const at = stack.map((s) => s.tag).lastIndexOf(tag);
      if (at >= 0) stack.length = at;
    } else if (tag !== "line" && tag !== "hr") {
      const node = { tag, arg: decode(arg.replace(/^["']|["']$/g, "")), children: [] };
      out().push(node);
      stack.push(node);
    }
  }
  if (last < text.length) out().push(decode(text.slice(last)));
  return root;
}

function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function plain(nodes: Node[]): string {
  return nodes.map((n) => (typeof n === "string" ? n : plain(n.children))).join("");
}

function render(nodes: Node[], key = ""): React.ReactNode {
  return nodes.map((node, i) => {
    const k = `${key}${i}`;
    if (typeof node === "string") return <Fragment key={k}>{node}</Fragment>;
    if (DROPPED.has(node.tag)) return null;
    const inner = render(node.children, `${k}.`);
    switch (node.tag) {
      case "b":
        return <strong key={k}>{inner}</strong>;
      case "i":
        return <em key={k}>{inner}</em>;
      case "u":
        return <u key={k}>{inner}</u>;
      case "s":
        return <s key={k}>{inner}</s>;
      case "size":
        // Nexus headings are [size=5]/[size=6]; smaller sizes are body text.
        return Number(node.arg) >= 4 ? (
          <span key={k} className="block text-base font-semibold">
            {inner}
          </span>
        ) : (
          <Fragment key={k}>{inner}</Fragment>
        );
      case "url": {
        const href = safeHref(node.arg || plain(node.children));
        return href ? (
          <a
            key={k}
            href={href}
            target="_blank"
            rel="noreferrer noopener nofollow"
            className="text-[color:var(--accent-text)] underline"
          >
            {inner}
          </a>
        ) : (
          <Fragment key={k}>{inner}</Fragment>
        );
      }
      case "*":
        return (
          <span key={k} className="block pl-4 -indent-3">
            {"• "}
            {inner}
          </span>
        );
      case "quote":
      case "spoiler":
        return (
          <span
            key={k}
            className="my-1 block border-l-2 border-[color:var(--border)] pl-3"
          >
            {inner}
          </span>
        );
      case "code":
      case "font":
        return node.tag === "code" || /courier|mono/i.test(node.arg) ? (
          <code key={k} className="font-mono text-[0.92em]">
            {inner}
          </code>
        ) : (
          <Fragment key={k}>{inner}</Fragment>
        );
      default:
        return <Fragment key={k}>{inner}</Fragment>;
    }
  });
}

export default function BBCode({ source, className }: { source: string; className?: string }) {
  // List items are blocks already; the line breaks Nexus puts between them
  // would double every gap.
  const tidy = source.replace(/\n?<br\s*\/?>\s*(?=\[\*\]|\[\/list\])/gi, "");
  return <div className={className}>{render(parse(tidy))}</div>;
}
