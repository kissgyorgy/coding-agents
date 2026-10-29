import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerTools from "./tools.js";

export default function (pi: ExtensionAPI) {
  registerTools(pi);
}
