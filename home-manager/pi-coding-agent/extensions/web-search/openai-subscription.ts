/**
 * OpenAI Subscription backend — ChatGPT Codex endpoint with JWT auth.
 */
import * as os from "node:os";
import type { AuthResult, SearchBackend } from "./types";

const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

function extractAccountId(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT token");
  const payload = JSON.parse(atob(parts[1]!));
  const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
  if (!accountId)
    throw new Error("No chatgpt_account_id in token. Re-run /login.");
  return accountId;
}

export function openaiSubscription(model: string): SearchBackend {
  const provider = "openai-codex";
  return {
    name: `${provider}/${model}`,

    async getAuth(ctx): Promise<AuthResult | undefined> {
      const codexModel = ctx.modelRegistry.find(provider, model);
      if (codexModel) {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(codexModel);
        if (auth.ok) return { apiKey: auth.apiKey, headers: auth.headers };
      }
      const key = await (ctx.modelRegistry as any).getApiKeyForProvider?.(
        provider,
      );
      if (key) return { apiKey: key };
      return undefined;
    },

    buildRequest(auth, query, instructions) {
      let accountId: string;
      try {
        accountId = extractAccountId(auth.apiKey);
      } catch (e: any) {
        return { error: e.message };
      }

      const userAgent = `pi (${os.platform()} ${os.release()}; ${os.arch()})`;

      return {
        url: `${CODEX_BASE_URL}/codex/responses`,
        headers: {
          ...auth.headers,
          Authorization: `Bearer ${auth.apiKey}`,
          "chatgpt-account-id": accountId,
          "OpenAI-Beta": "responses=experimental",
          originator: "pi",
          "User-Agent": userAgent,
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          store: false,
          stream: true,
          instructions,
          input: [{ role: "user", content: query }],
          tools: [{ type: "web_search", external_web_access: true }],
          tool_choice: "auto",
        }),
      };
    },
  };
}
