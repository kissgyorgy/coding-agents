import type { Model, Provider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_BASE_URL = "http://127.0.0.1:1234/v1";

type ChatModel = Model<"openai-completions">;

interface ModelCatalog {
  models: {
    type: string;
    key: string;
    display_name: string;
    max_context_length: number;
    capabilities?: { vision?: boolean };
    loaded_instances: {
      id: string;
      config: { context_length: number };
    }[];
  }[];
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("LM Studio server URL must use http or https");
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "") + "/v1";
  return url.toString().replace(/\/$/, "");
}

async function getJson(
  url: string,
  apiKey: string | undefined,
  signal: AbortSignal,
) {
  const response = await fetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `LM Studio model discovery returned HTTP ${response.status}`,
    );
  }
  return response.json();
}

async function getCatalog(
  endpoint: string,
  apiKey: string | undefined,
  signal: AbortSignal,
) {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  const [available, catalog] = await Promise.all([
    getJson(`${endpoint}/models`, apiKey, requestSignal),
    getJson(
      `${endpoint.replace(/\/v1$/, "")}/api/v1/models`,
      apiKey,
      requestSignal,
    ),
  ]);
  if (!Array.isArray(available?.data) || !Array.isArray(catalog?.models)) {
    throw new Error("LM Studio returned an invalid model catalog");
  }
  return { available, catalog };
}

export default function lmStudioExtension(pi: ExtensionAPI): void {
  const baseUrl = normalizeBaseUrl(
    process.env.LMSTUDIO_BASE_URL || DEFAULT_BASE_URL,
  );
  const api = openAICompletionsApi();
  let models: ChatModel[] = [];

  const provider: Provider<"openai-completions"> = {
    id: "lmstudio",
    name: "LM Studio",
    baseUrl,
    auth: {
      apiKey: {
        name: "LM Studio",
        login: async (interaction) => {
          const enteredUrl = await interaction.prompt({
            type: "text",
            message: "LM Studio server URL",
            placeholder: baseUrl,
          });
          const endpoint = normalizeBaseUrl(enteredUrl.trim() || baseUrl);
          const apiKey = (
            await interaction.prompt({
              type: "secret",
              message: "API key (optional)",
            })
          ).trim();
          await getCatalog(endpoint, apiKey || undefined, interaction.signal);
          return {
            type: "api_key",
            key: apiKey,
            env: { LMSTUDIO_BASE_URL: endpoint },
          };
        },
        resolve: async ({ ctx, credential }) => {
          const endpoint = normalizeBaseUrl(
            credential?.env?.LMSTUDIO_BASE_URL ??
              (await ctx.env("LMSTUDIO_BASE_URL")) ??
              baseUrl,
          );
          const apiKey = credential?.key ?? (await ctx.env("LMSTUDIO_API_KEY"));
          return {
            auth: { apiKey: apiKey || "lm-studio", baseUrl: endpoint },
            env: { ...credential?.env, LMSTUDIO_BASE_URL: endpoint },
            source: credential ? "stored credential" : "LM Studio local server",
          };
        },
      },
    },
    getModels: () => models,
    async refreshModels(context) {
      if (!context.allowNetwork || context.signal.aborted) return;

      const credential =
        context.credential?.type === "api_key" ? context.credential : undefined;
      const endpoint = normalizeBaseUrl(
        credential?.env?.LMSTUDIO_BASE_URL ?? context.baseUrl ?? baseUrl,
      );
      const { available, catalog } = await getCatalog(
        endpoint,
        credential?.key,
        context.signal,
      );
      const availableIds = new Set(
        available.data.map((model: { id: string }) => model.id),
      );
      const discovered: ChatModel[] = [];
      for (const model of (catalog as ModelCatalog).models) {
        if (model.type !== "llm") continue;
        const instances = model.loaded_instances.filter((instance) =>
          availableIds.has(instance.id),
        );
        const entries =
          instances.length > 0
            ? instances.map((instance) => ({
                id: instance.id,
                contextWindow: instance.config.context_length,
              }))
            : availableIds.has(model.key)
              ? [{ id: model.key, contextWindow: model.max_context_length }]
              : [];
        for (const entry of entries) {
          if (
            !Number.isSafeInteger(entry.contextWindow) ||
            entry.contextWindow <= 0
          ) {
            throw new Error(
              `LM Studio returned an invalid context size for ${entry.id}`,
            );
          }
          discovered.push({
            ...entry,
            name: `${model.display_name} (LM Studio)`,
            provider: "lmstudio",
            api: "openai-completions",
            baseUrl: endpoint,
            reasoning: false,
            input: model.capabilities?.vision ? ["text", "image"] : ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            maxTokens: Math.min(16384, entry.contextWindow),
          });
        }
      }
      await context.publish({
        update: () => {
          models = discovered;
        },
      });
    },
    stream: (model, context, options) => api.stream(model, context, options),
    streamSimple: (model, context, options) =>
      api.streamSimple(model, context, options),
  };

  pi.registerProvider(provider);
}
