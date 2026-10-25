/**
 * A GitHub README, written over as the BBCode a Nexus description is in, so
 * a mod from GitHub is drawn by the same renderer (`components/bbcode.tsx`)
 * and its pictures are copied by the same code as a Nexus mod's.
 *
 * Only what READMEs actually use: headings, lists, emphasis, inline and
 * fenced code, links, images (Markdown and `<img>`), quotes and rules. Other
 * HTML is dropped by the renderer, its text kept. Relative links and images
 * are made absolute against the README's own place in the repository —
 * pictures to the raw file, links to the page GitHub shows.
 */

export type ReadmeBase = {
  /** Where a relative image resolves: the README's raw download address. */
  raw: string;
  /** Where a relative link resolves: the README's page on github.com. */
  page: string;
};

function absolute(url: string, base: string): string | null {
  try {
    const u = new URL(url.trim(), base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Inline Markdown in one run of text. */
function inline(text: string, base: ReadmeBase): string {
  // Code spans first, so nothing inside them is read as emphasis or a link.
  const spans: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, code: string) => {
    spans.push(code);
    return `\u0000${spans.length - 1}\u0000`;
  });

  s = s
    // A linked badge or picture: [![alt](img)](link) — the picture is enough.
    .replace(/\[!\[[^\]]*\]\(([^)\s]+)[^)]*\)\]\(([^)\s]+)[^)]*\)/g, (_, img: string) => {
      const src = absolute(img, base.raw);
      return src ? `[img]${src}[/img]` : "";
    })
    .replace(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g, (_, img: string) => {
      const src = absolute(img, base.raw);
      return src ? `[img]${src}[/img]` : "";
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, label: string, href: string) => {
      const url = href.startsWith("#") ? null : absolute(href, base.page);
      return url ? `[url=${url}]${label}[/url]` : label;
    })
    .replace(/<(https?:\/\/[^>\s]+)>/g, "[url]$1[/url]")
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "[b]$2[/b]")
    .replace(/(?<![\w*])\*(?=\S)([^*]+?)(?<=\S)\*(?![\w*])/g, "[i]$1[/i]")
    .replace(/(?<!\w)_(?=\S)([^_]+?)(?<=\S)_(?!\w)/g, "[i]$1[/i]")
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "[s]$1[/s]");

  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `[code]${spans[Number(i)]}[/code]`);
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

export function markdownToBBCode(markdown: string, base: ReadmeBase): string {
  const source = markdown
    .replace(/\r/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // An HTML picture is as much a picture as a Markdown one.
    .replace(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, (_, src: string) => {
      const url = absolute(src, base.raw);
      return url ? `![](${url})` : "";
    })
    .replace(/<br\s*\/?>/gi, "\n");

  const out: string[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length) out.push(inline(paragraph.join(" "), base));
    paragraph = [];
  };
  const flushList = () => {
    if (list) out.push(`[list]${list.map((item) => `[*]${inline(item, base)}`).join("")}[/list]`);
    list = null;
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };

  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      while (++i < lines.length && !lines[i].trimStart().startsWith(fence[1])) body.push(lines[i]);
      out.push(`[code]${body.join("\n")}[/code]`);
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      out.push(`[size=5]${inline(heading[1], base)}[/size]`);
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      continue; // a rule: the gap around it says as much
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      flushParagraph();
      (list ??= []).push(item[1]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      // A wrapped list item carries on.
      list[list.length - 1] += ` ${line.trim()}`;
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      out.push(`[quote]${inline(quote[1], base)}[/quote]`);
      continue;
    }

    flushList();
    // Markdown joins a paragraph's lines; GitHub draws them as one.
    paragraph.push(line.trim());
  }
  flush();

  return out.join("\n\n");
}
