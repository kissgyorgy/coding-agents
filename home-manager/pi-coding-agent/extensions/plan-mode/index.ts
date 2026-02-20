import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { complete, getModel } from "@mariozechner/pi-ai";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import {
  CustomEditor,
  DynamicBorder,
  getAgentDir,
  getMarkdownTheme,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  Container,
  Key,
  Markdown,
  type SelectItem,
  SelectList,
  Text,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";
import {
  extractTodoItems,
  markCompletedSteps,
  parsePlanSections,
  type TodoItem,
} from "./utils.js";
import { randomFunnySlug } from "./funny-names.js";

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
  return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

interface ModelRef {
  provider: string;
  id: string;
}

interface PlanModeSettings {
  slugModel?: ModelRef;
  executionModel?: ModelRef;
}

const SETTINGS_PATH = join(getAgentDir(), "plan-mode.json");

function loadSettings(): PlanModeSettings {
  try {
    if (existsSync(SETTINGS_PATH)) {
      return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
    }
  } catch {
    /* ignore */
  }
  return {};
}

function saveSettings(settings: PlanModeSettings): void {
  mkdirSync(getAgentDir(), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

async function showPlanViewModal(
  ctx: ExtensionContext,
  filePath: string,
): Promise<void> {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    ctx.ui.notify("Failed to read plan file", "error");
    return;
  }

  const planRelative = relative(ctx.cwd, filePath);

  await ctx.ui.custom<void>(
    (tui, theme, _kb, done) => {
      const mdTheme = getMarkdownTheme();
      const md = new Markdown(content, 1, 0, mdTheme);
      let offset = 0;
      let renderedLines: string[] = [];
      let cachedWidth = 0;

      function getTerminalRows(): number {
        const maybeTui = tui as unknown as {
          rows?: number;
          height?: number;
          getHeight?: () => number;
          getDimensions?: () => { height?: number };
          terminal?: { rows?: number; height?: number };
        };
        const byMethod =
          typeof maybeTui.getHeight === "function"
            ? maybeTui.getHeight()
            : undefined;
        const byDimensions =
          typeof maybeTui.getDimensions === "function"
            ? maybeTui.getDimensions()?.height
            : undefined;

        return (
          byMethod ??
          byDimensions ??
          maybeTui.rows ??
          maybeTui.height ??
          maybeTui.terminal?.rows ??
          maybeTui.terminal?.height ??
          process.stdout.rows ??
          24
        );
      }

      function getViewportHeight(): number {
        // Reserve rows for top/bottom status UI + modal chrome.
        // This avoids clipping the top border in smaller terminals.
        return Math.max(getTerminalRows() - 8, 5);
      }

      function getMaxOffset(): number {
        return Math.max(0, renderedLines.length - getViewportHeight());
      }

      return {
        render(width: number): string[] {
          const innerWidth = Math.max(1, width - 2);
          if (width !== cachedWidth) {
            renderedLines = md.render(innerWidth);
            cachedWidth = width;
          }

          const vh = getViewportHeight();
          const maxOff = getMaxOffset();
          if (offset > maxOff) offset = maxOff;

          const visible = renderedLines.slice(offset, offset + vh);
          const scrollable = renderedLines.length > vh;

          // Top border with title and scroll position (width-safe on narrow terminals)
          const rawTitleText = ` 📋 ${planRelative} `;
          const rawScrollText = scrollable
            ? ` ${offset + 1}–${Math.min(offset + vh, renderedLines.length)}/${renderedLines.length} `
            : "";
          const scrollText = truncateToWidth(
            rawScrollText,
            Math.max(0, Math.floor(innerWidth * 0.4)),
            "…",
          );
          const titleText = truncateToWidth(
            rawTitleText,
            Math.max(0, innerWidth - visibleWidth(scrollText)),
            "…",
          );
          const topFill = Math.max(
            0,
            innerWidth - visibleWidth(titleText) - visibleWidth(scrollText),
          );
          const topBorder =
            theme.fg("accent", "╭") +
            theme.fg("accent", theme.bold(titleText)) +
            theme.fg("accent", "─".repeat(topFill)) +
            theme.fg("dim", scrollText) +
            theme.fg("accent", "╮");

          // Content lines with side borders
          const contentLines = visible.map((line) => {
            const rendered = truncateToWidth(line, innerWidth);
            const pad = Math.max(0, innerWidth - visibleWidth(rendered));
            return (
              theme.fg("accent", "│") +
              rendered +
              " ".repeat(pad) +
              theme.fg("accent", "│")
            );
          });

          // Pad remaining viewport with empty lines
          for (let i = visible.length; i < vh; i++) {
            contentLines.push(
              theme.fg("accent", "│") +
                " ".repeat(innerWidth) +
                theme.fg("accent", "│"),
            );
          }

          // Bottom border with help text (width-safe on narrow terminals)
          const helpText = truncateToWidth(
            " ↑↓ scroll • PgUp/PgDn page • Home/End jump • Esc close ",
            innerWidth,
            "…",
          );
          const botFill = Math.max(0, innerWidth - visibleWidth(helpText));
          const botBorder =
            theme.fg("accent", "╰") +
            theme.fg("dim", helpText) +
            theme.fg("accent", "─".repeat(botFill)) +
            theme.fg("accent", "╯");

          return [topBorder, ...contentLines, botBorder];
        },

        invalidate(): void {
          cachedWidth = 0;
        },

        handleInput(data: string): void {
          const vh = getViewportHeight();
          const maxOff = getMaxOffset();

          if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
            done();
          } else if (matchesKey(data, Key.up)) {
            if (offset > 0) {
              offset--;
              tui.requestRender();
            }
          } else if (matchesKey(data, Key.down)) {
            if (offset < maxOff) {
              offset++;
              tui.requestRender();
            }
          } else if (matchesKey(data, "pageUp") || matchesKey(data, "pageup")) {
            offset = Math.max(0, offset - vh);
            tui.requestRender();
          } else if (
            matchesKey(data, "pageDown") ||
            matchesKey(data, "pagedown")
          ) {
            offset = Math.min(maxOff, offset + vh);
            tui.requestRender();
          } else if (matchesKey(data, Key.home)) {
            if (offset !== 0) {
              offset = 0;
              tui.requestRender();
            }
          } else if (matchesKey(data, Key.end)) {
            if (offset !== maxOff) {
              offset = maxOff;
              tui.requestRender();
            }
          }
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "95%",
        maxHeight: "90%",
      },
    },
  );
}

export default function planModeExtension(pi: ExtensionAPI): void {
  let planModeEnabled = false;
  let executionMode = false;
  let todoItems: TodoItem[] = [];
  let planFilePath: string | null = null;
  let planFullText: string | null = null;
  let settings: PlanModeSettings = {};
  let preExecutionModel: { provider: string; id: string } | null = null;
  let planFileModifiedThisTurn = false;

  const PLAN_TEMPLATE = readFileSync(
    join(__dirname, "plan-template.md"),
    "utf-8",
  );

  async function generateSlug(
    text: string,
    ctx: ExtensionContext,
  ): Promise<string> {
    try {
      const slugProvider = settings.slugModel?.provider ?? "anthropic";
      const slugModelId = settings.slugModel?.id ?? "claude-haiku-4-5";
      const model =
        ctx.modelRegistry.find(slugProvider, slugModelId) ??
        getModel("anthropic", "claude-haiku-4-5");
      const apiKey = model
        ? await ctx.modelRegistry.getApiKey(model)
        : undefined;
      if (model && apiKey) {
        const response = await complete(
          model,
          {
            messages: [
              {
                role: "user" as const,
                content: [
                  {
                    type: "text" as const,
                    text: `Given this task, provide a short 2-4 word kebab-case slug for a filename. Reply with ONLY the slug, nothing else.

Example: plan-editor-shortcut

Task:
${text}`,
                  },
                ],
                timestamp: Date.now(),
              },
            ],
          },
          { apiKey, maxTokens: 50, signal: AbortSignal.timeout(5_000) },
        );
        const raw = response.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "")
          .slice(0, 40);
        if (raw) return raw;
      }
    } catch {
      /* fall through to funny name */
    }
    return randomFunnySlug();
  }

  function planFilenameWithDedup(plansDir: string, slug: string): string {
    const base = join(plansDir, `plan-${slug}.md`);
    if (!existsSync(base)) return base;
    let i = 2;
    while (existsSync(join(plansDir, `plan-${slug}-${i}.md`))) i++;
    return join(plansDir, `plan-${slug}-${i}.md`);
  }

  async function writePlanFile(
    items: TodoItem[],
    fullText: string | null,
    cwd: string,
    ctx: ExtensionContext,
  ): Promise<string> {
    const plansDir = join(cwd, "plans");
    mkdirSync(plansDir, { recursive: true });
    const todoList = items.map((t) => `${t.step}. ${t.text}`).join("\n");

    // Parse sections from fullText if it already has structured headers (avoids duplicating them)
    const parsed = fullText ? parsePlanSections(fullText) : null;
    const implementationText = parsed?.implementation ?? fullText;
    const overview = parsed?.overview || "";

    // Generate slug from implementation text or todo list
    const slug = await generateSlug(implementationText || todoList, ctx);

    // Create collision-safe filename
    const filePath = planFilenameWithDedup(plansDir, slug);

    const files =
      parsed?.files ||
      (implementationText ? extractFileReferences(implementationText) : "");

    const content = `# Overview
${overview ? `\n${overview}\n` : "\n"}
# Implementation plan
${implementationText ? `\n${implementationText}\n` : "\n"}
# Files to modify
${files ? `\n${files}\n` : "\n"}
# Todo items
${todoList}
`;
    writeFileSync(filePath, content);
    return filePath;
  }

  function extractFileReferences(text: string): string {
    const filePattern = /(?:^|\s)([`"']?(?:[\w./~-]+\/)+[\w.-]+[`"']?)/gm;
    const seen = new Set<string>();
    const files: string[] = [];
    for (const match of text.matchAll(filePattern)) {
      const file = match[1].replace(/^[`"']+|[`"']+$/g, "");
      if (
        !seen.has(file) &&
        file.includes("/") &&
        !file.startsWith("http") &&
        !file.startsWith("//")
      ) {
        seen.add(file);
        files.push(`- ${file}`);
      }
    }
    return files.join("\n");
  }

  /** Rewrite an existing plan file in-place with updated content (no slug generation). */
  function updatePlanFileInPlace(
    filePath: string,
    items: TodoItem[],
    fullText: string | null,
  ): void {
    const todoList = items.map((t) => `${t.step}. ${t.text}`).join("\n");

    // Parse sections from fullText if it already has structured headers (avoids duplicating them)
    const parsed = fullText ? parsePlanSections(fullText) : null;
    const implementationText = parsed?.implementation ?? fullText;
    const files =
      parsed?.files ||
      (implementationText ? extractFileReferences(implementationText) : "");

    // Prefer parsed overview, then fall back to existing file overview
    let overview = parsed?.overview || "";
    if (!overview) {
      try {
        const existing = readFileSync(filePath, "utf-8");
        const overviewMatch = existing.match(
          /^# Overview\n\n([\s\S]*?)\n\n# Implementation plan/m,
        );
        if (overviewMatch) {
          overview = overviewMatch[1].trim();
        }
      } catch {
        /* ignore */
      }
    }

    const content = `# Overview
${overview ? `\n${overview}\n` : "\n"}
# Implementation plan
${implementationText ? `\n${implementationText}\n` : "\n"}
# Files to modify
${files ? `\n${files}\n` : "\n"}
# Todo items
${todoList}
`;
    writeFileSync(filePath, content);
  }

  pi.registerFlag("plan", {
    description: "Start in plan mode (read-only exploration)",
    type: "boolean",
    default: false,
  });

  function updateStatus(ctx: ExtensionContext): void {
    // Footer status
    if (executionMode && todoItems.length > 0) {
      const completed = todoItems.filter((t) => t.completed).length;
      ctx.ui.setStatus(
        "plan-mode",
        ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`),
      );
    } else if (planModeEnabled) {
      ctx.ui.setStatus(
        "plan-mode",
        ctx.ui.theme.fg("warning", "⏸ plan") +
          ctx.ui.theme.fg("dim", " (ctrl+g)"),
      );
    } else {
      ctx.ui.setStatus("plan-mode", undefined);
    }

    // Plan file path on the right side of the footer status area.
    if (planModeEnabled && planFilePath) {
      const planRelative = relative(ctx.cwd, planFilePath);
      ctx.ui.setStatus(
        "plan-mode-file",
        ctx.ui.theme.fg("dim", `📝 ${planRelative}`),
      );
    } else {
      ctx.ui.setStatus("plan-mode-file", undefined);
    }

    // Widget (above editor)
    if (executionMode && todoItems.length > 0) {
      const lines = todoItems.map((item) => {
        if (item.completed) {
          return (
            ctx.ui.theme.fg("success", "☑ ") +
            ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
          );
        }
        return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
      });
      ctx.ui.setWidget("plan-todos", lines);
    } else {
      ctx.ui.setWidget("plan-todos", undefined);
    }
  }

  function togglePlanMode(ctx: ExtensionContext): void {
    planModeEnabled = !planModeEnabled;
    executionMode = false;
    // Preserve todoItems, planFilePath and planFullText so the plan
    // survives toggling off/on (avoids losing state and creating duplicate files).

    if (planModeEnabled) {
      ctx.ui.notify("Plan mode enabled.");
    } else {
      ctx.ui.notify("Plan mode disabled.");
    }
    updateStatus(ctx);
    persistState();
  }

  async function startExecution(ctx: ExtensionContext): Promise<void> {
    planModeEnabled = false;
    executionMode = true;

    // Read plan file and extract todos for progress tracking
    const fileContents = readFileSync(planFilePath!, "utf-8");
    const extracted = extractTodoItems(fileContents);
    if (extracted.length > 0) {
      todoItems = extracted;
      planFullText = fileContents;
    }

    // Switch to execution model if configured
    if (settings.executionModel) {
      // Save current model for restoration
      if (ctx.model) {
        preExecutionModel = { provider: ctx.model.provider, id: ctx.model.id };
      }
      const execModel = ctx.modelRegistry.find(
        settings.executionModel.provider,
        settings.executionModel.id,
      );
      if (execModel) {
        const success = await pi.setModel(execModel);
        if (!success) {
          ctx.ui.notify(
            `Plan execution model ${settings.executionModel.provider}/${settings.executionModel.id}: no API key`,
            "warning",
          );
        }
      } else {
        ctx.ui.notify(
          `Plan execution model ${settings.executionModel.provider}/${settings.executionModel.id} not found`,
          "warning",
        );
      }
    }

    updateStatus(ctx);
    persistState();

    const planRelative = relative(ctx.cwd, planFilePath!);
    pi.sendMessage(
      {
        customType: "plan-mode-execute",
        content: `Read and execute the plan in ${planRelative} step by step. Follow the todo items in order. After completing each step, include a [DONE:n] tag in your response (e.g. [DONE:1], [DONE:2]).

Start with step 1.`,
        display: true,
      },
      { triggerTurn: true },
    );
  }

  function persistState(): void {
    pi.appendEntry("plan-mode", {
      enabled: planModeEnabled,
      todos: todoItems,
      executing: executionMode,
      planFile: planFilePath,
    });
  }

  async function viewPlan(ctx: ExtensionContext): Promise<void> {
    if (!planFilePath || !existsSync(planFilePath)) {
      ctx.ui.notify("No plan file to view", "warning");
      return;
    }
    await showPlanViewModal(ctx, planFilePath);
  }

  pi.registerCommand("plan", {
    description: "Toggle plan mode",
    handler: async (_args, ctx) => togglePlanMode(ctx),
  });

  pi.registerCommand("plan:execute", {
    description:
      "Execute the current plan (exit plan mode and start tracked execution)",
    handler: async (_args, ctx) => {
      if (!planFilePath || !existsSync(planFilePath)) {
        ctx.ui.notify(
          "No plan file to execute. Create a plan first with /plan",
          "warning",
        );
        return;
      }
      if (executionMode) {
        ctx.ui.notify("Already executing a plan", "warning");
        return;
      }
      await startExecution(ctx);
    },
  });

  pi.registerCommand("todos", {
    description: "Show current plan todo list",
    handler: async (_args, ctx) => {
      if (todoItems.length === 0) {
        ctx.ui.notify("No todos. Create a plan first with /plan", "info");
        return;
      }
      const list = todoItems
        .map(
          (item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`,
        )
        .join("\n");
      ctx.ui.notify(`Plan Progress:\n${list}`, "info");
    },
  });

  pi.registerCommand("plan:edit", {
    description: "Edit the current plan file",
    handler: async (_args, ctx) => {
      const isNew = !planFilePath || !existsSync(planFilePath);
      const currentContent = isNew
        ? PLAN_TEMPLATE
        : readFileSync(planFilePath, "utf-8");

      const edited = await ctx.ui.editor("Edit plan:", currentContent);
      if (edited == null || edited === currentContent) return;
      if (isNew && edited === PLAN_TEMPLATE) return;

      if (isNew) {
        await createNewPlanFile(edited, ctx);
      } else {
        savePlanEdit(edited, ctx);
      }
    },
  });

  pi.registerCommand("plan:delete", {
    description: "Delete the current plan file and reset plan state",
    handler: async (_args, ctx) => {
      if (!planFilePath || !existsSync(planFilePath)) {
        ctx.ui.notify("No plan file to delete", "warning");
        return;
      }
      const planRelative = relative(ctx.cwd, planFilePath);
      const ok = await ctx.ui.confirm(
        "Delete plan?",
        `Delete ${planRelative} and reset plan state?`,
      );
      if (!ok) return;

      unlinkSync(planFilePath);
      planModeEnabled = false;
      executionMode = false;
      todoItems = [];
      planFilePath = null;
      planFullText = null;
      updateStatus(ctx);
      persistState();
      ctx.ui.notify(`Deleted ${planRelative}`, "info");
    },
  });

  pi.registerCommand("plan:view", {
    description: "View the current plan file in a read-only modal",
    handler: async (_args, ctx) => {
      await viewPlan(ctx);
    },
  });

  pi.registerCommand("plan:model", {
    description: "Configure models for plan slug generation and execution",
    handler: async (_args, ctx) => {
      // First: pick which setting to change
      const setting = await ctx.ui.custom<string | null>(
        (tui, theme, _kb, done) => {
          const slugCurrent = settings.slugModel
            ? `${settings.slugModel.provider}/${settings.slugModel.id}`
            : "anthropic/claude-haiku-4-5 (default)";
          const execCurrent = settings.executionModel
            ? `${settings.executionModel.provider}/${settings.executionModel.id}`
            : "(keep current model)";

          const items: SelectItem[] = [
            {
              value: "slug",
              label: "Slug/Overview model",
              description: slugCurrent,
            },
            {
              value: "execution",
              label: "Execution model",
              description: execCurrent,
            },
          ];

          const container = new Container();
          container.addChild(
            new DynamicBorder((str) => theme.fg("accent", str)),
          );
          container.addChild(
            new Text(theme.fg("accent", theme.bold(" Plan Mode Models")), 0, 0),
          );

          const selectList = new SelectList(items, 4, {
            selectedPrefix: (text) => theme.fg("accent", text),
            selectedText: (text) => theme.fg("accent", text),
            description: (text) => theme.fg("muted", text),
            scrollInfo: (text) => theme.fg("dim", text),
            noMatch: (text) => theme.fg("warning", text),
          });
          selectList.onSelect = (item) => done(item.value);
          selectList.onCancel = () => done(null);
          container.addChild(selectList);
          container.addChild(
            new Text(
              theme.fg("dim", " ↑↓ navigate • enter select • esc cancel"),
            ),
          );
          container.addChild(
            new DynamicBorder((str) => theme.fg("accent", str)),
          );

          return {
            render: (w: number) => container.render(w),
            invalidate: () => container.invalidate(),
            handleInput: (data: string) => {
              selectList.handleInput(data);
              tui.requestRender();
            },
          };
        },
      );

      if (!setting) return;

      // Second: pick model
      const available = await ctx.modelRegistry.getAvailable();
      const modelItems: SelectItem[] = available.map((m) => ({
        value: `${m.provider}/${m.id}`,
        label: `${m.provider}/${m.id}`,
        description: m.name ?? "",
      }));

      if (setting === "execution") {
        modelItems.unshift({
          value: "(keep-current)",
          label: "(keep current model)",
          description: "Don't switch model when executing",
        });
      }

      const modelChoice = await ctx.ui.custom<string | null>(
        (tui, theme, _kb, done) => {
          const title =
            setting === "slug" ? "Slug/Overview Model" : "Execution Model";
          const container = new Container();
          container.addChild(
            new DynamicBorder((str) => theme.fg("accent", str)),
          );
          container.addChild(
            new Text(theme.fg("accent", theme.bold(` ${title}`)), 0, 0),
          );

          const selectList = new SelectList(
            modelItems,
            Math.min(modelItems.length, 15),
            {
              selectedPrefix: (text) => theme.fg("accent", text),
              selectedText: (text) => theme.fg("accent", text),
              description: (text) => theme.fg("muted", text),
              scrollInfo: (text) => theme.fg("dim", text),
              noMatch: (text) => theme.fg("warning", text),
            },
          );
          selectList.onSelect = (item) => done(item.value);
          selectList.onCancel = () => done(null);
          container.addChild(selectList);
          container.addChild(
            new Text(
              theme.fg(
                "dim",
                " ↑↓ navigate • enter select • type to filter • esc cancel",
              ),
            ),
          );
          container.addChild(
            new DynamicBorder((str) => theme.fg("accent", str)),
          );

          return {
            render: (w: number) => container.render(w),
            invalidate: () => container.invalidate(),
            handleInput: (data: string) => {
              selectList.handleInput(data);
              tui.requestRender();
            },
          };
        },
      );

      if (!modelChoice) return;

      if (setting === "slug") {
        const [provider, ...idParts] = modelChoice.split("/");
        settings.slugModel = { provider, id: idParts.join("/") };
        saveSettings(settings);
        ctx.ui.notify(`Plan slug model: ${modelChoice}`, "info");
      } else {
        if (modelChoice === "(keep-current)") {
          delete settings.executionModel;
          saveSettings(settings);
          ctx.ui.notify("Execution model: keep current", "info");
        } else {
          const [provider, ...idParts] = modelChoice.split("/");
          settings.executionModel = { provider, id: idParts.join("/") };
          saveSettings(settings);
          ctx.ui.notify(`Execution model: ${modelChoice}`, "info");
        }
      }
    },
  });

  pi.registerShortcut(Key.ctrlAlt("p"), {
    description: "Toggle plan mode",
    handler: async (ctx) => togglePlanMode(ctx),
  });

  pi.registerShortcut(Key.ctrlAlt("o"), {
    description: "View current plan file",
    handler: async (ctx) => {
      await viewPlan(ctx);
    },
  });

  // Reset plan file modification tracking at start of each turn
  pi.on("agent_start", async () => {
    planFileModifiedThisTurn = false;
  });

  // Track when plan file is modified via edit/write
  pi.on("tool_result", async (event, ctx) => {
    if (!planModeEnabled || !planFilePath) return;
    if (event.toolName === "edit" || event.toolName === "write") {
      const targetPath = resolve(
        ctx.cwd,
        String(event.input.path).replace(/^@/, ""),
      );
      if (targetPath === planFilePath) {
        planFileModifiedThisTurn = true;
      }
    }
  });

  // In execution mode, start with a clean context from the execute message onward.
  // Otherwise, filter out plan mode context injections.
  pi.on("context", async (event) => {
    if (planModeEnabled) return;

    if (executionMode) {
      const startIdx = event.messages.findIndex((m) => {
        const msg = m as AgentMessage & { customType?: string };
        return msg.customType === "plan-mode-execute";
      });
      return { messages: startIdx >= 0 ? event.messages.slice(startIdx) : [] };
    }

    return {
      messages: event.messages.filter((m) => {
        const msg = m as AgentMessage & { customType?: string };
        if (msg.customType === "plan-mode-context") return false;
        if (msg.customType === "plan-execution-context") return false;
        if (msg.role !== "user") return true;

        const content = msg.content;
        if (typeof content === "string") {
          return !content.includes("[PLAN MODE ACTIVE]");
        }
        if (Array.isArray(content)) {
          return !content.some(
            (c) =>
              c.type === "text" &&
              (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
          );
        }
        return true;
      }),
    };
  });

  // Inject plan mode instructions before agent starts
  pi.on("before_agent_start", async (event, ctx) => {
    if (planModeEnabled) {
      // Create plan file on first prompt if none exists
      if (!planFilePath || !existsSync(planFilePath)) {
        const slug = await generateSlug(event.prompt, ctx);
        const plansDir = join(ctx.cwd, "plans");
        mkdirSync(plansDir, { recursive: true });
        planFilePath = planFilenameWithDedup(plansDir, slug);
        writeFileSync(planFilePath, PLAN_TEMPLATE);
        persistState();
      }

      const planRelative = relative(ctx.cwd, planFilePath);
      return {
        message: {
          customType: "plan-mode-context",
          content: readFileSync(
            join(__dirname, "plan-mode-active.md"),
            "utf-8",
          ).replaceAll("${planRelative}", planRelative),
          display: false,
        },
      };
    }

    // Inject remaining steps on each agent run during execution to keep it going
    if (executionMode && todoItems.length > 0) {
      const remaining = todoItems.filter((t) => !t.completed);
      const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
      return {
        message: {
          customType: "plan-execution-context",
          content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`,
          display: false,
        },
      };
    }
  });

  // Track [DONE:n] progress after each turn
  pi.on("turn_end", async (event, ctx) => {
    if (!executionMode || todoItems.length === 0) return;
    if (!isAssistantMessage(event.message)) return;

    const text = getTextContent(event.message);
    if (markCompletedSteps(text, todoItems) > 0) {
      updateStatus(ctx);
    }
    persistState();
  });

  // Handle plan completion and post-plan interactive picker
  pi.on("agent_end", async (event, ctx) => {
    // Check if execution is complete
    if (executionMode && todoItems.length > 0) {
      if (todoItems.every((t) => t.completed)) {
        // Restore pre-execution model
        if (preExecutionModel) {
          const prevModel = ctx.modelRegistry.find(
            preExecutionModel.provider,
            preExecutionModel.id,
          );
          if (prevModel) await pi.setModel(prevModel);
          preExecutionModel = null;
        }

        executionMode = false;
        todoItems = [];
        updateStatus(ctx);
        persistState(); // Save cleared state so resume doesn't restore old execution mode
      }
      return;
    }

    if (!planModeEnabled || !ctx.hasUI) return;

    // If plan file was modified this turn, read and display it
    if (planFileModifiedThisTurn && planFilePath && existsSync(planFilePath)) {
      const planContent = readFileSync(planFilePath, "utf-8");
      const extracted = extractTodoItems(planContent);
      if (extracted.length > 0) {
        todoItems = extracted;
        planFullText = planContent;
        persistState();
      }

      return;
    }

    // Fallback: Extract todos from last assistant message (when model didn't write to file)
    const lastAssistant = [...event.messages]
      .reverse()
      .find(isAssistantMessage);
    if (lastAssistant) {
      const text = getTextContent(lastAssistant);
      const extracted = extractTodoItems(text);
      if (extracted.length > 0) {
        todoItems = extracted;
        planFullText = text;
      }
    }

    // Write plan file to disk.
    // If a plan file already exists on disk, update it in-place (preserve slug/path).
    // Only create a brand new file (with Haiku slug) when no file exists yet.
    if (todoItems.length > 0) {
      if (planFilePath && existsSync(planFilePath)) {
        updatePlanFileInPlace(planFilePath, todoItems, planFullText);
      } else {
        planFilePath = await writePlanFile(
          todoItems,
          planFullText,
          ctx.cwd,
          ctx,
        );
      }
    }


  });

  // Shared helper: save edited plan content back to file, re-parse todos
  function savePlanEdit(edited: string, ctx: ExtensionContext): void {
    if (!planFilePath) return;
    writeFileSync(planFilePath, edited);

    const oldCompleted = new Set(
      todoItems.filter((t) => t.completed).map((t) => t.text),
    );
    const newItems = extractTodoItems(edited);
    if (newItems.length > 0) {
      for (const item of newItems) {
        if (oldCompleted.has(item.text)) item.completed = true;
      }
      todoItems = newItems;
      planFullText = edited;
    }
    updateStatus(ctx);
    persistState();
    ctx.ui.notify(`Plan updated (${planFilePath})`, "info");
  }

  // Async helper for creating a new plan file from edited content
  // (used by PlanEditor and /plan:edit when no file exists yet)
  async function createNewPlanFile(
    edited: string,
    ctx: ExtensionContext,
  ): Promise<void> {
    const newItems = extractTodoItems(edited);
    if (newItems.length > 0) {
      todoItems = newItems;
      planFullText = edited;
    }
    planFilePath = await writePlanFile(
      newItems.length > 0
        ? newItems
        : [{ step: 1, text: "Define plan steps", completed: false }],
      edited,
      ctx.cwd,
      ctx,
    );
    updateStatus(ctx);
    persistState();
    ctx.ui.notify(`Plan created (${planFilePath})`, "info");
  }

  // Custom editor that intercepts Ctrl+G to edit the plan file in $EDITOR.
  // When plan/execution mode is active, Ctrl+G opens the plan file (or a
  // template for new plans) in $VISUAL/$EDITOR. On save, the content is
  // written back and todo items are re-parsed.
  let editorCtx: ExtensionContext | null = null;

  class PlanEditor extends CustomEditor {
    handleInput(data: string): void {
      // Tab on empty editor in plan mode: show /plan:* command completions
      if (
        matchesKey(data, Key.tab) &&
        planModeEnabled &&
        !this.isShowingAutocomplete() &&
        this.getText().trim() === ""
      ) {
        // Type "/plan:" char by char so "/" triggers autocomplete
        // and subsequent chars progressively filter to plan:* commands
        this.setText("");
        for (const ch of "/plan:") {
          super.handleInput(ch);
        }
        return;
      }

      if (
        matchesKey(data, Key.ctrl("g")) &&
        (planModeEnabled || executionMode) &&
        editorCtx
      ) {
        // Determine content: existing plan file or template for new plan
        const isNew = !planFilePath || !existsSync(planFilePath);
        const planContent = isNew
          ? PLAN_TEMPLATE
          : readFileSync(planFilePath, "utf-8");

        // Save current prompt text so we can restore it after
        const originalText = editorCtx.ui.getEditorText();

        editorCtx.ui.setEditorText(planContent);

        // Delegate to built-in externalEditor (synchronous: spawnSync)
        super.handleInput(data);

        const edited = editorCtx.ui.getEditorText();

        // Restore the user's original prompt
        editorCtx.ui.setEditorText(originalText);

        // Save if changed (skip if unchanged or still the unmodified template)
        if (
          edited != null &&
          edited !== planContent &&
          !(isNew && edited === PLAN_TEMPLATE)
        ) {
          if (isNew) {
            // Fire-and-forget: create new plan file asynchronously (slug via Haiku)
            void createNewPlanFile(edited, editorCtx);
          } else {
            savePlanEdit(edited, editorCtx);
          }
        }
        return;
      }
      super.handleInput(data);
    }
  }

  // Restore state on session start/resume
  pi.on("session_start", async (_event, ctx) => {
    settings = loadSettings();

    // Register plan-aware editor for Ctrl+G interception
    editorCtx = ctx;
    ctx.ui.setEditorComponent(
      (tui, theme, kb) => new PlanEditor(tui, theme, kb),
    );

    if (pi.getFlag("plan") === true) {
      planModeEnabled = true;
    }

    const entries = ctx.sessionManager.getEntries();

    // Restore persisted state
    const planModeEntry = entries
      .filter(
        (e: { type: string; customType?: string }) =>
          e.type === "custom" && e.customType === "plan-mode",
      )
      .pop() as
      | { data?: { enabled: boolean; todos?: TodoItem[]; executing?: boolean } }
      | undefined;

    if (planModeEntry?.data) {
      planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
      todoItems = planModeEntry.data.todos ?? todoItems;
      executionMode = planModeEntry.data.executing ?? executionMode;
      planFilePath =
        (planModeEntry.data as { planFile?: string }).planFile ?? planFilePath;
    }

    // On resume: re-scan messages to rebuild completion state
    // Only scan messages AFTER the last "plan-mode-execute" to avoid picking up [DONE:n] from previous plans
    const isResume = planModeEntry !== undefined;
    if (isResume && executionMode && todoItems.length > 0) {
      // Find the index of the last plan-mode-execute entry (marks when current execution started)
      let executeIndex = -1;
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i] as { type: string; customType?: string };
        if (entry.customType === "plan-mode-execute") {
          executeIndex = i;
          break;
        }
      }

      // Safety: if executionMode is stuck but the execute marker is
      // missing (e.g. after compaction), auto-clear to avoid an empty
      // context that makes the LLM loop or error.
      if (executeIndex === -1) {
        executionMode = false;
        planModeEnabled = false;
        todoItems = [];
        planFilePath = null;
        planFullText = null;
        persistState();
        ctx.ui.notify(
          "Plan execution state was stale — auto-cleared. Use /plan to start fresh.",
          "warning",
        );
      } else {
        // Only scan messages after the execute marker
        const messages: AssistantMessage[] = [];
        for (let i = executeIndex + 1; i < entries.length; i++) {
          const entry = entries[i];
          if (
            entry.type === "message" &&
            "message" in entry &&
            isAssistantMessage(entry.message as AgentMessage)
          ) {
            messages.push(entry.message as AssistantMessage);
          }
        }
        const allText = messages.map(getTextContent).join("\n");
        markCompletedSteps(allText, todoItems);
      }
    }

    updateStatus(ctx);
  });
}
