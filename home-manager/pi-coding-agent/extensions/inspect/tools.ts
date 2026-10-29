import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { showMarkdownViewModal } from "../lib/markdown-viewer.js";

interface ParameterSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, ParameterSchema>;
  required?: string[];
  items?: ParameterSchema;
  anyOf?: ParameterSchema[];
}

function parameterType(schema: ParameterSchema): string {
  if (schema.anyOf) return schema.anyOf.map(parameterType).join(" or ");
  if (schema.type === "array") {
    return schema.items
      ? `list of ${parameterType(schema.items)} values`
      : "list";
  }
  if (Array.isArray(schema.type)) return schema.type.join(" or ");
  return schema.type ?? "any value";
}

function parameterLines(schema: ParameterSchema, indent = "  "): string[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).flatMap(([name, field]) => {
    const status = required.has(name) ? "required" : "optional";
    const description = field.description
      ? ` — ${field.description.replace(/\s+/g, " ").trim()}`
      : "";
    const children = field.type === "array" ? field.items : field;
    return [
      `${indent}- \`${name}\` (${parameterType(field)}, ${status})${description}`,
      ...(children ? parameterLines(children, `${indent}  `) : []),
    ];
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("inspect:tools", {
    description: "List active tools with descriptions and readable parameters",
    handler: async (_args, ctx) => {
      const active = new Set(pi.getActiveTools());
      const tools = pi
        .getAllTools()
        .filter((tool) => active.has(tool.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      const lines = tools.map((tool) => {
        const namespace = tool.namespace
          ? ` — namespace: ${tool.namespace.name}`
          : "";
        const description = tool.description.replace(/\n/g, "\n  ");
        const parameters = parameterLines(tool.parameters);
        return [
          `- \`${tool.name}\`${namespace}`,
          ...(parameters.length ? parameters : ["  No parameters."]),
          "",
          `  ${description}`,
          "",
        ].join("\n");
      });

      await showMarkdownViewModal(
        ctx,
        `Active tools (${tools.length})`,
        lines.length ? lines.join("\n") : "No active tools.",
      );
    },
  });
}
