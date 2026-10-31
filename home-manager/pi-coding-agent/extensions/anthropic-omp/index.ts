import { randomUUID } from "node:crypto";
import type {
  OAuthCredential,
  Provider,
  StreamOptions,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi, hasApi } from "@earendil-works/pi-ai/compat";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  API_ORIGIN,
  claudeVersion,
  deviceId,
  isRecord,
  oauthHeaders,
  ompFetch,
  tokenKey,
  type WireIdentity,
} from "./transport.ts";
import { formatUsage, UsageClient } from "./usage.ts";

const PROVIDER_ID = "anthropic-omp";
const WARNING =
  "Anthropic OMP is an experimental third-party integration. Request compatibility does not guarantee included subscription billing; Anthropic may charge extra usage. Check https://claude.ai/settings/usage and disable extra usage there if you do not want overage charges.";

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function identify(
  credential: OAuthCredential,
  signal: AbortSignal,
): Promise<OAuthCredential> {
  try {
    const response = await fetch(
      `${API_ORIGIN}/api/claude_cli/bootstrap?entrypoint=cli&model=claude-opus-4-8`,
      {
        headers: {
          ...oauthHeaders(credential.access),
          "user-agent": `claude-code/${claudeVersion()}`,
        },
        signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
        redirect: "error",
      },
    );
    if (!response.ok) return credential;
    const payload: unknown = await response.json();
    const account = isRecord(payload) ? payload.oauth_account : undefined;
    if (!isRecord(account)) return credential;
    return {
      ...credential,
      accountId: nonEmpty(account.account_uuid),
      email: nonEmpty(account.account_email),
      orgId: nonEmpty(account.organization_uuid),
      orgName: nonEmpty(account.organization_name),
    };
  } catch {
    // Identity enrichment must not discard a successfully issued refresh token.
    return credential;
  }
}

export default function anthropicOmpExtension(pi: ExtensionAPI): void {
  const upstream = builtinProviders().find(
    (provider) => provider.id === "anthropic",
  );
  const oauth = upstream?.auth.oauth;
  if (!upstream || !oauth) {
    throw new Error(
      "Anthropic OMP requires Pi's built-in Anthropic OAuth provider",
    );
  }
  const api = anthropicMessagesApi();
  const usage = new UsageClient();
  const identities = new Map<string, Omit<WireIdentity, "sessionId">>();
  let activeKey: string | undefined;
  let sessionId: string = randomUUID();
  let lifecycle = new AbortController();
  let warned = false;
  let overageWarned = false;

  function updateStatus(ctx: ExtensionContext): void {
    if (ctx.model?.provider !== PROVIDER_ID || !activeKey) {
      ctx.ui.setStatus(PROVIDER_ID, undefined);
      return;
    }
    const report = usage.latest(activeKey);
    const counters = report?.windows
      .filter((entry) => entry.id === "5h" || entry.id === "7d")
      .map(
        (entry) =>
          `${entry.id} ${entry.percent === undefined ? "?" : `${entry.percent.toFixed(0)}%`}`,
      )
      .join(" · ");
    ctx.ui.setStatus(
      PROVIDER_ID,
      counters ? `Claude ${counters} used` : undefined,
    );
    if (report?.overageInUse && !overageWarned && ctx.hasUI) {
      overageWarned = true;
      ctx.ui.notify(
        "Anthropic reports this account is using paid extra usage. Check Claude's usage settings.",
        "warning",
      );
    }
  }

  function notice(ctx: ExtensionContext): void {
    if (ctx.model?.provider === PROVIDER_ID && !warned && ctx.hasUI) {
      warned = true;
      ctx.ui.notify(WARNING, "warning");
    }
    updateStatus(ctx);
  }

  function requestOptions<T extends StreamOptions>(options?: T): T {
    const token = options?.apiKey;
    const key = token ? tokenKey(token) : undefined;
    const identity = key ? identities.get(key) : undefined;
    if (!token || !token.startsWith("sk-ant-oat") || !identity) {
      throw new Error("Run /login anthropic-omp before using Anthropic OMP");
    }
    if (options && "client" in options && options.client !== undefined) {
      throw new Error("Anthropic OMP does not support injected SDK clients");
    }
    activeKey = key;
    return {
      ...options,
      // An explicit session id covers nested calls; otherwise use the current Pi session.
      sessionId: options?.sessionId ?? sessionId,
      fetch: ompFetch(
        options?.fetch ?? globalThis.fetch,
        token,
        { ...identity, sessionId: options?.sessionId ?? sessionId },
        (headers) => usage.observe(token, headers),
      ),
    } as T;
  }

  const provider: Provider<"anthropic-messages"> = {
    id: PROVIDER_ID,
    name: "Anthropic (OMP-style)",
    baseUrl: API_ORIGIN,
    auth: {
      oauth: {
        name: "Anthropic (OMP-style, Claude Pro/Max)",
        isSubscription: true,
        async login(interaction, options) {
          interaction.notify({ type: "info", message: WARNING });
          let credential: OAuthCredential;
          try {
            credential = await oauth.login(interaction, options);
          } catch {
            interaction.signal.throwIfAborted();
            throw new Error(
              "Anthropic OMP login failed; try /login anthropic-omp again",
            );
          }
          const enriched = await identify(credential, interaction.signal);
          return {
            ...enriched,
            ompInstallId: options?.getDeviceId?.() ?? randomUUID(),
          };
        },
        async refresh(credential, signal) {
          try {
            // Preserve account/org/install identity when Pi rotates the tokens.
            return {
              ...credential,
              ...(await oauth.refresh(credential, signal)),
            };
          } catch {
            signal.throwIfAborted();
            throw new Error(
              "Anthropic OMP token refresh failed; re-login may be required",
            );
          }
        },
        async toAuth(credential) {
          const auth = await oauth.toAuth(credential);
          if (!auth.apiKey?.startsWith("sk-ant-oat")) {
            throw new Error(
              "Anthropic OMP requires an Anthropic OAuth credential",
            );
          }
          const key = tokenKey(auth.apiKey);
          const accountId = nonEmpty(credential.accountId);
          const installId = nonEmpty(credential.ompInstallId);
          if (!installId) {
            throw new Error(
              "Anthropic OMP identity is missing; run /login anthropic-omp",
            );
          }
          identities.set(key, {
            accountId,
            deviceId: deviceId(installId, accountId),
          });
          if (identities.size > 4) {
            identities.delete(identities.keys().next().value!);
          }
          activeKey = key;
          return auth;
        },
      },
    },
    getModels: () =>
      upstream
        .getModels()
        .filter((model) => hasApi(model, "anthropic-messages"))
        .map((model) => ({
          ...model,
          provider: PROVIDER_ID,
          baseUrl: API_ORIGIN,
          name: `${model.name} (OMP)`,
        })),
    stream: (model, context, options) =>
      api.stream(model, context, requestOptions(options)),
    streamSimple: (model, context, options) =>
      api.streamSimple(model, context, requestOptions(options)),
  };
  pi.registerProvider(provider);

  pi.registerCommand("anthropic-usage", {
    description:
      "Show Claude subscription limits and extra-usage spending for anthropic-omp",
    handler: async (_args, ctx) => {
      const owner = lifecycle;
      const signal = ctx.signal
        ? AbortSignal.any([ctx.signal, owner.signal])
        : owner.signal;
      try {
        const auth = await ctx.modelRegistry.getProviderAuth(PROVIDER_ID);
        signal.throwIfAborted();
        const token = auth?.auth.apiKey;
        if (!token) {
          ctx.ui.notify("Run /login anthropic-omp first", "warning");
          return;
        }
        activeKey = tokenKey(token);
        const result = await usage.read(token, signal);
        signal.throwIfAborted();
        if (result.warning) ctx.ui.notify(result.warning, "warning");
        if (result.report) ctx.ui.notify(formatUsage(result.report), "info");
        updateStatus(ctx);
      } catch {
        if (!signal.aborted) {
          ctx.ui.notify(
            "Claude usage unavailable; check your anthropic-omp login and network connection",
            "warning",
          );
        }
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    lifecycle = new AbortController();
    sessionId = ctx.sessionManager.getSessionId();
    warned = false;
    overageWarned = false;
    notice(ctx);
  });
  pi.on("model_select", (_event, ctx) => notice(ctx));
  pi.on("after_provider_response", (_event, ctx) => updateStatus(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    lifecycle.abort();
    usage.clear();
    identities.clear();
    activeKey = undefined;
    ctx.ui.setStatus(PROVIDER_ID, undefined);
  });
}
