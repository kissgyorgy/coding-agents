import type { LanguagePlugin, QueryOperation } from "./types";

export type { IndexingTracker, LanguagePlugin, QueryOperation } from "./types";

export {
  languageId as nix,
  getConfig as nixConfig,
  getWorkspaceRoot as nixWorkspaceRoot,
  fileExtensions as nixExtensions,
  languageIdForPath as nixLanguageId,
  workspaceMarkers as nixWorkspaceMarkers,
} from "./nix";
export {
  languageId as python,
  getConfig as pythonConfig,
  getWorkspaceRoot as pythonWorkspaceRoot,
  fileExtensions as pythonExtensions,
  languageIdForPath as pythonLanguageId,
  workspaceMarkers as pythonWorkspaceMarkers,
} from "./python";
export {
  languageId as typescript,
  getConfig as typescriptConfig,
  getWorkspaceRoot as typescriptWorkspaceRoot,
  fileExtensions as typescriptExtensions,
  languageIdForPath as typescriptLanguageId,
  workspaceMarkers as typescriptWorkspaceMarkers,
} from "./typescript";
export {
  languageId as go,
  getConfig as goConfig,
  getWorkspaceRoot as goWorkspaceRoot,
  fileExtensions as goExtensions,
  languageIdForPath as goLanguageId,
  workspaceMarkers as goWorkspaceMarkers,
} from "./go";

import * as nix from "./nix";
import * as python from "./python";
import * as typescript from "./typescript";
import * as go from "./go";

export const languages: Record<string, LanguagePlugin> = {
  nix,
  python,
  typescript,
  go,
};

export function getSupportedLanguages(): string[] {
  return Object.keys(languages);
}

export function explainLanguageQueryError(
  language: string,
  error: unknown,
  query: string,
  operation: QueryOperation,
): string | null {
  return (
    languages[language]?.explainQueryError?.(error, query, operation) ?? null
  );
}
