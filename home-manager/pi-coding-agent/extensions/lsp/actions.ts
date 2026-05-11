import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import {
  formatCompletion,
  formatDiagnostics,
  formatDocumentSymbols,
  formatReferences,
  formatRename,
  formatWorkspaceSymbol,
} from "./formatters";
import { explainLanguageQueryError } from "./languages";
import type { ServerManager } from "./server-manager";
import {
  formatDefinitionWithImplementation,
  resolveSymbolLocation,
  uriToPath,
} from "./symbols";
import type { Action, WorkspaceEdit } from "./types";
import { ACTIONS } from "./types";
import { applyWorkspaceEdit } from "./workspace-edits";
import { normalizeToolPath } from "./workspace-discovery";

export type LspParams = {
  language: string;
  action: Action | string;
  file?: string;
  line?: number;
  character?: number;
  new_name?: string;
  query?: string;
};

type ToolUpdate = (update: {
  content: Array<{ type: "text"; text: string }>;
}) => void;

export type LspActionResult = {
  content: string;
  details: {
    language: string;
    action: string;
    summary: string;
  };
};

function requireFile(file?: string): string {
  if (!file) throw new Error("'file' parameter is required for this action");
  return file.startsWith("@") ? file.slice(1) : file;
}

function requirePosition(
  line?: number,
  character?: number,
): { line: number; character: number } {
  if (line === undefined || character === undefined)
    throw new Error(
      "'line' and 'character' parameters are required for this action (1-based)",
    );
  return { line: line - 1, character: character - 1 };
}

function resolveFile(cwd: string, file?: string): string {
  return normalizeToolPath(cwd, requireFile(file));
}

function summarizeResult(resultText: string): string {
  const lines = resultText.split("\n");
  const headerLine = lines[0] ?? "";
  let inCodeBlock = false;
  const sigLines: string[] = [];
  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("``")) {
      if (inCodeBlock) break;
      inCodeBlock = true;
      continue;
    }
    if (!inCodeBlock) continue;
    if (!trimmed) continue;
    sigLines.push(line);
    if (
      trimmed.endsWith("{") ||
      trimmed.endsWith(")") ||
      trimmed.endsWith(";") ||
      trimmed.endsWith(":")
    )
      break;
  }
  return sigLines.length > 0
    ? headerLine + "\n" + sigLines.join("\n")
    : headerLine;
}

async function runWorkspaceSymbol(
  manager: ServerManager,
  ctx: ExtensionContext,
  language: string,
  query: string,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const clients = await manager.getClientsForQuery(ctx.cwd, language);

  const settled = await Promise.allSettled(
    clients.map(({ client }) => client.workspaceSymbol(query, signal)),
  );

  const results = settled.flatMap((result) => {
    if (result.status !== "fulfilled") return [];
    return Array.isArray(result.value) ? result.value : [];
  });

  const failures = settled.filter((result) => result.status === "rejected");
  if (results.length === 0 && failures.length === settled.length) {
    const explanation = failures.flatMap((result) => {
      if (result.status !== "rejected") return [];
      const message = explainLanguageQueryError(
        language,
        result.reason,
        query,
        "workspace_symbol",
      );
      return message ? [message] : [];
    })[0];
    if (explanation) throw new Error(explanation);

    throw new Error(
      failures
        .map((result) =>
          result.status === "rejected" ? String(result.reason) : "",
        )
        .filter(Boolean)
        .join("; ") || "workspace_symbol failed",
    );
  }

  return results;
}

async function runAction(
  params: LspParams,
  manager: ServerManager,
  ctx: ExtensionContext,
  signal?: AbortSignal,
  onUpdate?: ToolUpdate,
): Promise<string> {
  const language = params.language;
  const action = params.action as Action;

  onUpdate?.({
    content: [
      {
        type: "text",
        text: `Using ${language} LSP...`,
      },
    ],
  });

  if (!ACTIONS.includes(action)) {
    throw new Error(
      `Unknown action: ${params.action}. Supported: ${ACTIONS.join(", ")}`,
    );
  }

  if (action === "workspace_symbol") {
    onUpdate?.({
      content: [{ type: "text", text: `Running ${action}...` }],
    });
    const result = await runWorkspaceSymbol(
      manager,
      ctx,
      language,
      params.query ?? "",
      signal,
    );
    return formatWorkspaceSymbol(result);
  }

  if (!params.file && (action === "definition" || action === "references")) {
    if (!params.query)
      throw new Error(
        `'query' (symbol name) is required for ${action} when 'file' is not provided`,
      );

    const { location, client } = await resolveSymbolLocation(
      manager,
      ctx.cwd,
      language,
      params.query,
      signal,
    );

    onUpdate?.({
      content: [{ type: "text", text: `Running ${action}...` }],
    });

    if (action === "definition") {
      return formatDefinitionWithImplementation([location], client);
    }

    const result = await client.references(
      uriToPath(location.uri),
      location.range.start.line,
      location.range.start.character,
      true,
      signal,
    );
    return formatReferences(result);
  }

  const file = resolveFile(ctx.cwd, params.file);
  const { client } = await manager.getClientForFile(ctx.cwd, language, file);

  onUpdate?.({
    content: [{ type: "text", text: `Running ${action}...` }],
  });

  switch (action) {
    case "definition": {
      const pos = requirePosition(params.line, params.character);
      const result = await client.definition(
        file,
        pos.line,
        pos.character,
        signal,
      );
      return formatDefinitionWithImplementation(result, client);
    }

    case "references": {
      const pos = requirePosition(params.line, params.character);
      const result = await client.references(
        file,
        pos.line,
        pos.character,
        true,
        signal,
      );
      return formatReferences(result);
    }

    case "rename": {
      const pos = requirePosition(params.line, params.character);
      if (!params.new_name)
        throw new Error("'new_name' parameter is required for rename");
      const result = (await client.rename(
        file,
        pos.line,
        pos.character,
        params.new_name,
        signal,
      )) as WorkspaceEdit | null;
      if (!result) return "No rename changes generated.";
      try {
        await applyWorkspaceEdit(result, client);
      } catch (error) {
        throw new Error(
          `Failed to apply rename edits: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return formatRename(result);
    }

    case "document_symbols": {
      const result = await client.documentSymbols(file, signal);
      return formatDocumentSymbols(result);
    }

    case "completion": {
      const pos = requirePosition(params.line, params.character);
      const result = await client.completion(
        file,
        pos.line,
        pos.character,
        signal,
      );
      return formatCompletion(result);
    }

    case "diagnostics": {
      const diags = await client.getDiagnostics(file, signal);
      return formatDiagnostics(diags);
    }

    default:
      throw new Error(
        `Unknown action: ${action}. Supported: ${ACTIONS.join(", ")}`,
      );
  }
}

export async function executeLspAction(
  params: LspParams,
  manager: ServerManager,
  ctx: ExtensionContext,
  signal?: AbortSignal,
  onUpdate?: ToolUpdate,
): Promise<LspActionResult> {
  const resultText = await runAction(params, manager, ctx, signal, onUpdate);
  const truncation = truncateHead(resultText, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  return {
    content: truncation.content,
    details: {
      language: params.language,
      action: params.action,
      summary: summarizeResult(resultText),
    },
  };
}
