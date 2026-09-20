declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string });
    readonly window: Window;
  }
}

declare module "turndown" {
  interface Options {
    headingStyle?: "setext" | "atx";
    codeBlockStyle?: "indented" | "fenced";
    bulletListMarker?: "-" | "+" | "*";
  }

  interface Rule {
    filter: (node: HTMLElement) => boolean;
    replacement: (content: string, node: HTMLElement) => string;
  }

  export default class TurndownService {
    constructor(options?: Options);
    remove(filter: string | string[]): this;
    addRule(key: string, rule: Rule): this;
    turndown(input: string | HTMLElement): string;
  }
}
