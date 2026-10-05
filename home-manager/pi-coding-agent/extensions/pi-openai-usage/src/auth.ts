import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CODEX_PROVIDER_ID = "openai-codex";

export type CodexCredentialSource = "registry" | "auth_file";
export type CodexCredentialErrorCode = "missing_credentials" | "missing_account_id";

export type CodexOAuthCredentials = {
  accessToken: string;
  accountId: string;
  source: CodexCredentialSource;
  toJSON(): RedactedCodexCredentials;
};

export type RedactedCodexCredentials = {
  accessToken: "<redacted>";
  accountId: string;
  source: CodexCredentialSource;
};

export type CodexCredentialDiagnostics = {
  source: CodexCredentialSource | "none";
  checkedSources: CodexCredentialSource[];
  hasAccessToken: boolean;
  hasAccountId: boolean;
  accountId?: string;
};

export type CodexCredentialError = {
  code: CodexCredentialErrorCode;
  message: string;
};

export type CodexCredentialResolution =
  | {
      ok: true;
      credentials: CodexOAuthCredentials;
      diagnostics: CodexCredentialDiagnostics;
      toJSON(): {
        ok: true;
        credentials: RedactedCodexCredentials;
        diagnostics: CodexCredentialDiagnostics;
      };
    }
  | {
      ok: false;
      error: CodexCredentialError;
      diagnostics: CodexCredentialDiagnostics;
    };

export type CodexModelRegistry = {
  getApiKeyForProvider?: (
    provider: string,
  ) => string | undefined | Promise<string | undefined>;
};

export type ResolveCodexOAuthCredentialsOptions = {
  modelRegistry?: CodexModelRegistry;
  authFilePath?: string;
  home?: string;
  env?: Partial<Pick<NodeJS.ProcessEnv, "PI_CODING_AGENT_DIR">>;
};

export async function resolveCodexOAuthCredentials(
  options: ResolveCodexOAuthCredentialsOptions = {},
): Promise<CodexCredentialResolution> {
  const checkedSources: CodexCredentialSource[] = [];
  let bestAttempt: CredentialAttempt | undefined;

  const registryAttempt = await readRegistryCredentials(options.modelRegistry);
  checkedSources.push("registry");
  if (registryAttempt?.credentials !== undefined) {
    return credentialSuccess(registryAttempt.credentials, checkedSources);
  }
  bestAttempt = bestCredentialAttempt(bestAttempt, registryAttempt);

  const authFileAttempt = readAuthFileCredentials(authFilePath(options));
  checkedSources.push("auth_file");
  if (authFileAttempt?.credentials !== undefined) {
    return credentialSuccess(authFileAttempt.credentials, checkedSources);
  }
  bestAttempt = bestCredentialAttempt(bestAttempt, authFileAttempt);

  return credentialFailure(bestAttempt, checkedSources);
}

export function authFilePath(options: ResolveCodexOAuthCredentialsOptions = {}): string {
  if (options.authFilePath !== undefined) return options.authFilePath;

  const env = options.env ?? process.env;
  const configuredAgentDir = env.PI_CODING_AGENT_DIR?.trim();
  const agentDir =
    configuredAgentDir !== undefined && configuredAgentDir.length > 0
      ? configuredAgentDir
      : join(options.home ?? homedir(), ".pi", "agent");
  return join(agentDir, "auth.json");
}

type CredentialMaterial = {
  accessToken?: string;
  accountId?: string;
  source: CodexCredentialSource;
};

type CredentialAttempt = CredentialMaterial & {
  credentials?: CodexOAuthCredentials;
};

async function readRegistryCredentials(
  modelRegistry: CodexModelRegistry | undefined,
): Promise<CredentialAttempt | undefined> {
  if (modelRegistry?.getApiKeyForProvider === undefined) return undefined;

  try {
    const rawCredential = await modelRegistry.getApiKeyForProvider(CODEX_PROVIDER_ID);
    if (rawCredential === undefined) return undefined;

    return credentialAttempt(parseRegistryCredential(rawCredential));
  } catch {
    return undefined;
  }
}

function readAuthFileCredentials(path: string): CredentialAttempt | undefined {
  if (!existsSync(path)) return undefined;

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const root = asRecord(parsed);
    const entry = root === undefined ? undefined : asRecord(root[CODEX_PROVIDER_ID]);
    if (entry?.type !== "oauth") return undefined;

    return credentialAttempt({
      accessToken: trimmedString(entry.access),
      accountId: trimmedString(entry.accountId) ?? trimmedString(entry.account_id),
      source: "auth_file",
    });
  } catch {
    return undefined;
  }
}

function parseRegistryCredential(rawCredential: string): CredentialMaterial | undefined {
  const trimmed = rawCredential.trim();
  if (trimmed.length === 0) return undefined;

  const jsonCredentials = parseRegistryJsonCredential(trimmed);
  if (jsonCredentials !== undefined) return jsonCredentials;

  return {
    accessToken: trimmed,
    accountId: accountIdFromJwt(trimmed),
    source: "registry",
  };
}

function parseRegistryJsonCredential(rawCredential: string): CredentialMaterial | undefined {
  try {
    const parsed = JSON.parse(rawCredential) as unknown;
    const record = asRecord(parsed);
    if (record === undefined) return undefined;

    return {
      accessToken: trimmedString(record.access) ?? trimmedString(record.token),
      accountId: trimmedString(record.accountId) ?? trimmedString(record.account_id),
      source: "registry",
    };
  } catch {
    return undefined;
  }
}

function accountIdFromJwt(token: string): string | undefined {
  const payloadSegment = token.split(".")[1];
  if (payloadSegment === undefined) return undefined;

  try {
    const payload = JSON.parse(
      Buffer.from(toBase64(payloadSegment), "base64").toString("utf8"),
    ) as unknown;
    const payloadRecord = asRecord(payload);
    const authRecord = asRecord(payloadRecord?.["https://api.openai.com/auth"]);
    return trimmedString(authRecord?.chatgpt_account_id);
  } catch {
    return undefined;
  }
}

function toBase64(base64Url: string): string {
  const base64 = base64Url.replaceAll("-", "+").replaceAll("_", "/");
  const paddingLength = (4 - (base64.length % 4)) % 4;
  return `${base64}${"=".repeat(paddingLength)}`;
}

function credentialAttempt(material: CredentialMaterial | undefined): CredentialAttempt | undefined {
  if (material === undefined) return undefined;

  const attempt: CredentialAttempt = { ...material };
  const credentials = credentialsFromParts(material);
  if (credentials !== undefined) attempt.credentials = credentials;
  return attempt;
}

function credentialsFromParts(parts: CredentialMaterial): CodexOAuthCredentials | undefined {
  if (parts.accessToken === undefined || parts.accountId === undefined) return undefined;

  const accessToken = parts.accessToken;
  const accountId = parts.accountId;
  const source = parts.source;

  return {
    accessToken,
    accountId,
    source,
    toJSON() {
      return {
        accessToken: "<redacted>",
        accountId: redactAccountId(accountId),
        source,
      };
    },
  };
}

function bestCredentialAttempt(
  current: CredentialAttempt | undefined,
  next: CredentialAttempt | undefined,
): CredentialAttempt | undefined {
  if (next === undefined) return current;
  if (current === undefined) return next;
  if (next.accessToken !== undefined && current.accessToken === undefined) return next;
  return current;
}

function credentialFailure(
  bestAttempt: CredentialAttempt | undefined,
  checkedSources: CodexCredentialSource[],
): CodexCredentialResolution {
  const hasAccessToken = bestAttempt?.accessToken !== undefined;
  const hasAccountId = bestAttempt?.accountId !== undefined;
  const code: CodexCredentialErrorCode =
    hasAccessToken && !hasAccountId ? "missing_account_id" : "missing_credentials";

  return {
    ok: false,
    error: {
      code,
      message:
        code === "missing_account_id"
          ? "Missing openai-codex Account ID. Run /login openai-codex."
          : "Missing openai-codex OAuth credentials. Run /login openai-codex.",
    },
    diagnostics: {
      source: bestAttempt?.source ?? "none",
      checkedSources,
      hasAccessToken,
      hasAccountId,
      ...(bestAttempt?.accountId === undefined
        ? {}
        : { accountId: redactAccountId(bestAttempt.accountId) }),
    },
  };
}

function credentialSuccess(
  credentials: CodexOAuthCredentials,
  checkedSources: CodexCredentialSource[],
): CodexCredentialResolution {
  const diagnostics: CodexCredentialDiagnostics = {
    source: credentials.source,
    checkedSources,
    hasAccessToken: true,
    hasAccountId: true,
    accountId: redactAccountId(credentials.accountId),
  };

  return {
    ok: true,
    credentials,
    diagnostics,
    toJSON() {
      return { ok: true, credentials: credentials.toJSON(), diagnostics };
    },
  };
}

function redactAccountId(accountId: string): string {
  if (accountId.length <= 4) return "<redacted>";
  return `…${accountId.slice(-4)}`;
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
