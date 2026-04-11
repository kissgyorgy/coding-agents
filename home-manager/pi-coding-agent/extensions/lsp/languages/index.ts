import type { LspServerConfig } from "../lsp-client";

export interface LanguagePlugin {
  languageId: string;
  getConfig: (cwd: string) => LspServerConfig[];
  getWorkspaceRoot: (startDir: string, ctx: { cwd: string }) => string;
  fileExtensions: Set<string>;
  languageIdForPath: (filePath: string) => string | null;
  isIndexingDoneLog?: (message: string) => boolean;
}

export {
  languageId as nix,
  getConfig as nixConfig,
  getWorkspaceRoot as nixWorkspaceRoot,
  fileExtensions as nixExtensions,
  languageIdForPath as nixLanguageId,
} from "./nix";
export {
  languageId as python,
  getConfig as pythonConfig,
  getWorkspaceRoot as pythonWorkspaceRoot,
  fileExtensions as pythonExtensions,
  languageIdForPath as pythonLanguageId,
} from "./python";
export {
  languageId as typescript,
  getConfig as typescriptConfig,
  getWorkspaceRoot as typescriptWorkspaceRoot,
  fileExtensions as typescriptExtensions,
  languageIdForPath as typescriptLanguageId,
} from "./typescript";
export {
  languageId as go,
  getConfig as goConfig,
  getWorkspaceRoot as goWorkspaceRoot,
  fileExtensions as goExtensions,
  languageIdForPath as goLanguageId,
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
