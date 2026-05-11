import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONTINUE_COMMAND, CONTINUE_SHORTCUT } from "./shortcut.js";

interface ProviderErrorInfo {
  status: number;
  retryAfter?: string;
}

const CONTINUE_MESSAGE = "Continue.";

function sendContinueTurn(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  lastProviderError: ProviderErrorInfo | undefined,
): void {
  const message = {
    customType: "continue-turn",
    content: CONTINUE_MESSAGE,
    display: false,
    details: { lastProviderError },
  };

  if (ctx.isIdle()) {
    pi.sendMessage(message, { triggerTurn: true });
    ctx.ui.notify("Continuing session…", "info");
    return;
  }

  pi.sendMessage(message, { deliverAs: "followUp", triggerTurn: true });
  ctx.ui.notify("Continue queued for when the current turn finishes.", "info");
}

export default function (pi: ExtensionAPI) {
  let lastProviderError: ProviderErrorInfo | undefined;

  pi.on("after_provider_response", (event) => {
    if (event.status < 400) {
      lastProviderError = undefined;
      return;
    }

    const retryAfter = event.headers["retry-after"];
    lastProviderError = {
      status: event.status,
      ...(retryAfter ? { retryAfter } : {}),
    };
  });

  pi.registerShortcut(CONTINUE_SHORTCUT, {
    description: "Continue the session / retry after a provider error",
    handler: async (ctx) => {
      sendContinueTurn(pi, ctx, lastProviderError);
    },
  });

  pi.registerCommand(CONTINUE_COMMAND.slice(1), {
    description: "Continue the session / retry after a provider error",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();
      sendContinueTurn(pi, ctx, lastProviderError);
    },
  });
}
