export const ACTIONS = [
  "definition",
  "references",
  "rename",
  "document_symbols",
  "workspace_symbol",
  "completion",
] as const;

export type Action = (typeof ACTIONS)[number];

export type Position = { line: number; character: number };
export type Range = { start: Position; end: Position };
export type Location = { uri: string; range: Range };

export type LocationLink = {
  targetUri: string;
  targetRange: Range;
  targetSelectionRange: Range;
};

export type DocumentSymbol = {
  name: string;
  kind: number;
  range?: Range;
  selectionRange?: Range;
  children?: DocumentSymbol[];
  location?: Location;
  detail?: string;
};

export type SymbolInformation = {
  name: string;
  kind: number;
  location?: Location;
  containerName?: string;
};

export type TextEdit = {
  range: Range;
  newText: string;
};

export type WorkspaceEdit = {
  changes?: Record<string, TextEdit[]>;
  documentChanges?: (
    | {
        textDocument: { uri: string; version?: number | null };
        edits: TextEdit[];
      }
    | { kind: string; uri?: string; oldUri?: string; newUri?: string }
  )[];
};

export type MarkupContent = {
  kind: "plaintext" | "markdown";
  value: string;
};

export type CompletionItem = {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | MarkupContent;
  insertText?: string;
};

export type CompletionResult = {
  isIncomplete?: boolean;
  items: CompletionItem[];
};

export type Diagnostic = {
  range: Range;
  severity?: number;
  code?: number | string;
  source?: string;
  message: string;
};
