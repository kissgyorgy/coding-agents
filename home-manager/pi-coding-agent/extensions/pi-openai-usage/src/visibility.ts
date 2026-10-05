export type UsageModel = {
  provider: string;
  id?: string;
};

export type UsageModelRegistry = {
  isUsingOAuth(model: UsageModel): boolean;
};

export type UsageVisibilityInput = {
  showAlways: boolean;
  model: UsageModel | undefined;
  modelRegistry: UsageModelRegistry | undefined;
};

export type UsageVisibilityDecision =
  | { visible: true; reason: "show_always" | "eligible_model" }
  | { visible: false; reason: "ineligible_model" };

const ELIGIBLE_USAGE_PROVIDERS = new Set(["openai", "openai-codex"]);

export function decideUsageVisibility(input: UsageVisibilityInput): UsageVisibilityDecision {
  if (input.showAlways) return { visible: true, reason: "show_always" };

  if (isUsageEligibleModel(input.model, input.modelRegistry)) {
    return { visible: true, reason: "eligible_model" };
  }

  return { visible: false, reason: "ineligible_model" };
}

export function isUsageEligibleModel(
  model: UsageModel | undefined,
  modelRegistry: UsageModelRegistry | undefined,
): boolean {
  if (model === undefined) return false;
  if (!ELIGIBLE_USAGE_PROVIDERS.has(model.provider)) return false;
  return modelRegistry?.isUsingOAuth(model) === true;
}
