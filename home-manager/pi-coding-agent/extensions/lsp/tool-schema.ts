import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";
import { getSupportedLanguages } from "./languages";
import { ACTIONS } from "./types";

export const LspParamsSchema = Type.Object({
  language: Type.String({
    description: `Language to use. Supported: ${getSupportedLanguages().join(", ")}`,
  }),
  action: StringEnum([...ACTIONS]),
  file: Type.Optional(
    Type.String({
      description:
        "File path (relative to cwd). Required for: references, rename, document_symbols, completion, diagnostics. Optional for definition (uses query instead).",
    }),
  ),
  line: Type.Optional(
    Type.Number({
      description:
        "1-based line number. Required for: references, rename, completion. Optional for definition (uses query instead).",
    }),
  ),
  character: Type.Optional(
    Type.Number({
      description:
        "1-based column number. Required for: references, rename, completion. Optional for definition (uses query instead).",
    }),
  ),
  new_name: Type.Optional(
    Type.String({ description: "New name for rename action" }),
  ),
  query: Type.Optional(
    Type.String({
      description:
        "Symbol name for definition (when file not provided) or search query for workspace_symbol",
    }),
  ),
});
