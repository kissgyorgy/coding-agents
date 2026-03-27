import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { extractText, getDocumentProxy } from "unpdf";
import { isBinaryContentType, isBinaryUrl } from "./binary.ts";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB

async function readBodyBytes(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > maxBytes) {
      const excess = total - maxBytes;
      chunks.push(value.slice(0, value.byteLength - excess));
      truncated = true;
      reader.cancel();
      break;
    }
    chunks.push(value);
  }

  const result = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes: result, truncated };
}

async function readBodyText(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const { bytes } = await readBodyBytes(body, maxBytes);
  return new TextDecoder().decode(bytes);
}

type FetchResult =
  | { type: "html"; html: string; finalUrl: string }
  | { type: "pdf"; buffer: ArrayBuffer; finalUrl: string }
  | { type: "raw"; text: string; finalUrl: string; contentType: string };

async function fetchPage(
  url: string,
  signal?: AbortSignal,
): Promise<FetchResult> {
  if (isBinaryUrl(url)) {
    throw new Error(
      `Refusing to download binary file (detected from URL extension). ` +
        `Use curl to download this file directly.`,
    );
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const finalUrl = response.url;

  if (isBinaryContentType(contentType) || isBinaryUrl(finalUrl)) {
    throw new Error(
      `Refusing to download binary content (${contentType || "unknown type"}). ` +
        `Use a browser or curl to download this file directly.`,
    );
  }

  const contentLength = parseInt(
    response.headers.get("content-length") || "0",
    10,
  );

  const isPdf =
    contentType.includes("application/pdf") || finalUrl.endsWith(".pdf");

  if (isPdf) {
    if (contentLength > MAX_PDF_BYTES) {
      throw new Error(
        `PDF too large (${formatSize(contentLength)}, max ${formatSize(MAX_PDF_BYTES)}). ` +
          `Use curl to download it directly.`,
      );
    }
    const { bytes } = await readBodyBytes(response.body!, MAX_PDF_BYTES);
    return { type: "pdf", buffer: bytes.buffer, finalUrl };
  }

  if (contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `Response too large (${formatSize(contentLength)}, max ${formatSize(MAX_DOWNLOAD_BYTES)}). ` +
        `Use curl to download it directly.`,
    );
  }

  const text = await readBodyText(response.body!, MAX_DOWNLOAD_BYTES);

  if (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml")
  ) {
    return { type: "html", html: text, finalUrl };
  }

  return { type: "raw", text, finalUrl, contentType };
}

async function extractPdf(buffer: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = text as unknown as string[];
  return pages.join("\n\n");
}

function createTurndown(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  turndown.remove("video");
  turndown.remove("audio");
  turndown.remove("iframe");
  turndown.remove("svg");
  turndown.remove("canvas");
  turndown.remove("style");
  turndown.remove("script");

  turndown.addRule("emptyLinks", {
    filter: (node) => {
      if (node.nodeName !== "A") return false;
      const text = node.textContent?.trim() || "";
      return text === "" || text === "\n";
    },
    replacement: () => "",
  });

  return turndown;
}

function cleanMarkdown(raw: string): string {
  let md = raw;
  md = md.replace(/!\[\]\([^)]*?\.gif\)/g, "");
  md = md.replace(/!\[\]\(data:[^)]*\)/g, "");
  md = md.replace(/\n{3,}/g, "\n\n");
  return md.trim();
}

function extractContent(
  html: string,
  url: string,
): { title: string; markdown: string; excerpt: string } | null {
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;

  const reader = new Readability(document.cloneNode(true) as any);
  const article = reader.parse();
  if (article && article.textContent.trim().length > 50) {
    const turndown = createTurndown();
    turndown.remove("noscript");
    turndown.remove("nav");
    turndown.remove("footer");
    turndown.remove("header");
    const markdown = cleanMarkdown(turndown.turndown(article.content));
    return {
      title: article.title,
      markdown,
      excerpt: article.excerpt,
    };
  }

  const body = document.body;
  if (!body) return null;

  for (const sel of [
    "nav",
    "footer",
    "header",
    "aside",
    "[role=navigation]",
    "[role=banner]",
    "[role=contentinfo]",
  ]) {
    for (const el of Array.from(body.querySelectorAll(sel))) {
      el.remove();
    }
  }

  const turndown = createTurndown();
  const markdown = cleanMarkdown(turndown.turndown(body.innerHTML));
  if (markdown.length < 20) return null;

  const title = document.querySelector("title")?.textContent?.trim() || "";
  const metaDesc =
    document
      .querySelector('meta[name="description"]')
      ?.getAttribute("content")
      ?.trim() || "";

  return { title, markdown, excerpt: metaDesc };
}

function truncateAndFormat(output: string): string {
  const truncation = truncateHead(output, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  let final = truncation.content;
  if (truncation.truncated) {
    final +=
      `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
      `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
  }
  return final;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "fetch",
    label: "Fetch",
    description:
      "Fetch a web page and extract its main content as clean markdown. " +
      "Use when you need to read the content of a specific URL. " +
      "Returns the article title and content in markdown format, " +
      "with boilerplate (navigation, ads, footers) removed. " +
      "Also supports PDF URLs — extracts text content directly. " +
      "For other text-based formats (JSON, XML, plain text, etc.) returns raw content as-is. " +
      "Binary files (images, video, archives) are rejected.",
    promptSnippet:
      "Fetch a URL and extract its main content as clean markdown. Also reads PDFs. " +
      "Non-HTML/PDF text content is returned raw. Binary files are rejected.",
    parameters: Type.Object({
      url: Type.String({ description: "The URL to fetch" }),
    }),

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("fetch "));
      text += theme.fg("muted", args.url);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Fetching..."), 0, 0);
      }

      const text =
        result.content
          ?.filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n") || "";

      if (!expanded) {
        const firstLine =
          text.split("\n").find((l: string) => l.trim()) || "Done";
        return new Text(theme.fg("toolOutput", firstLine), 0, 0);
      }
      return new Text(theme.fg("toolOutput", text), 0, 0);
    },

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const url = params.url.replace(/^@/, "");

      onUpdate?.({
        content: [{ type: "text", text: `Fetching ${url}...` }],
      });

      let result: FetchResult;
      try {
        result = await fetchPage(url, signal);
      } catch (err: any) {
        if (err.name === "AbortError") {
          return { content: [{ type: "text", text: "Fetch cancelled." }] };
        }
        return {
          content: [{ type: "text", text: `Fetch error: ${err.message}` }],
          isError: true,
        };
      }

      if (result.type === "pdf") {
        try {
          const text = await extractPdf(result.buffer);
          if (text.trim().length < 20) {
            return {
              content: [
                {
                  type: "text",
                  text: `PDF at ${result.finalUrl} contains no extractable text (may be scanned/image-only).`,
                },
              ],
              isError: true,
            };
          }
          const output = `Source: ${result.finalUrl}\n\n---\n\n${text}`;
          return {
            content: [{ type: "text", text: truncateAndFormat(output) }],
            details: {
              url: result.finalUrl,
              title: "PDF Document",
              extracted: true,
            },
          };
        } catch (err: any) {
          return {
            content: [
              { type: "text", text: `PDF extraction error: ${err.message}` },
            ],
            isError: true,
          };
        }
      }

      if (result.type === "raw") {
        const output = `Source: ${result.finalUrl}\nContent-Type: ${result.contentType}\n\n---\n\n${result.text}`;
        return {
          content: [{ type: "text", text: truncateAndFormat(output) }],
          details: {
            url: result.finalUrl,
            title: result.finalUrl,
            extracted: false,
          },
        };
      }

      const extracted = extractContent(result.html, result.finalUrl);
      if (!extracted) {
        return {
          content: [
            {
              type: "text",
              text: `Could not extract content from ${result.finalUrl} — the page is not reader-friendly (may require JavaScript rendering, or is not an article).`,
            },
          ],
          isError: true,
        };
      }

      let output = `# ${extracted.title}\n\n`;
      if (extracted.excerpt) {
        output += `> ${extracted.excerpt}\n\n`;
      }
      output += `Source: ${result.finalUrl}\n\n---\n\n`;
      output += extracted.markdown;

      return {
        content: [{ type: "text", text: truncateAndFormat(output) }],
        details: {
          url: result.finalUrl,
          title: extracted.title,
          extracted: true,
        },
      };
    },
  });
}
