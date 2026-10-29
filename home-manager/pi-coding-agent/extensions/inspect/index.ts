import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerSkills from "./skills.js";
import registerSystemPrompt from "./systemprompt.js";
import registerTools from "./tools.js";

export default function (pi: ExtensionAPI) {
  registerTools(pi);
  registerSystemPrompt(pi);
  registerSkills(pi);
}
