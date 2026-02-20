export interface TodoItem {
  step: number;
  text: string;
  completed: boolean;
}

export function cleanStepText(text: string): string {
  let cleaned = text
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1") // Remove bold/italic
    .replace(/`([^`]+)`/g, "$1") // Remove code
    .replace(
      /^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
}

export function extractTodoItems(message: string): TodoItem[] {
  const items: TodoItem[] = [];
  const headerMatch =
    message.match(/(?:^|\n)#+ Todo items\s*\n/i) ||
    message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
  if (!headerMatch) return items;

  const headerStart = message.indexOf(headerMatch[0]) + headerMatch[0].length;
  // Stop at the next markdown heading (if any)
  const rest = message.slice(headerStart);
  const nextHeading = rest.match(/\n#+ /);
  const planSection = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;

  for (const match of planSection.matchAll(numberedPattern)) {
    const text = match[2]
      .trim()
      .replace(/\*{1,2}$/, "")
      .trim();
    if (
      text.length > 5 &&
      !text.startsWith("`") &&
      !text.startsWith("/") &&
      !text.startsWith("-")
    ) {
      const cleaned = cleanStepText(text);
      if (cleaned.length > 3) {
        items.push({ step: items.length + 1, text: cleaned, completed: false });
      }
    }
  }
  return items;
}

export function extractDoneSteps(message: string): number[] {
  const steps: number[] = [];
  for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
    const step = Number(match[1]);
    if (Number.isFinite(step)) steps.push(step);
  }
  return steps;
}

export function markCompletedSteps(text: string, items: TodoItem[]): number {
  const doneSteps = extractDoneSteps(text);
  for (const step of doneSteps) {
    const item = items.find((t) => t.step === step);
    if (item) item.completed = true;
  }
  return doneSteps.length;
}

export interface PlanSections {
  overview: string;
  implementation: string;
  files: string;
  todos: string;
}

/** Parse structured plan text into sections. Returns null if text doesn't contain section headers. */
export function parsePlanSections(text: string): PlanSections | null {
  if (!/^#+\s+(Overview|Implementation plan|Todo items)/im.test(text))
    return null;

  const buffers: Record<keyof PlanSections, string[]> = {
    overview: [],
    implementation: [],
    files: [],
    todos: [],
  };
  const lines = text.split("\n");
  let currentKey: keyof PlanSections | null = null;

  for (const line of lines) {
    const m = line.match(
      /^#+\s+(Overview|Implementation plan|Files to modify|Todo items)\s*$/i,
    );
    if (m) {
      const name = m[1].toLowerCase();
      if (name === "overview") currentKey = "overview";
      else if (name === "implementation plan") currentKey = "implementation";
      else if (name === "files to modify") currentKey = "files";
      else if (name === "todo items") currentKey = "todos";
      continue;
    }
    if (currentKey) {
      buffers[currentKey].push(line);
    }
  }

  const sections: PlanSections = {
    overview: "",
    implementation: "",
    files: "",
    todos: "",
  };
  for (const key of Object.keys(buffers) as (keyof PlanSections)[]) {
    sections[key] = buffers[key].join("\n").trim();
  }
  return sections;
}
