export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
  oldNum?: number;
  newNum?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  status: "modified" | "new" | "deleted";
  hunks: DiffHunk[];
}

export function parseDiff(raw: string): DiffFile[] {
  if (!raw.trim()) return [];
  // Strip trailing whitespace from the entire input
  raw = raw.trimEnd();

  const files: DiffFile[] = [];
  const fileSections = raw.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split("\n");

    let path = "";
    const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/);
    if (headerMatch) {
      path = headerMatch[2];
    }

    let status: DiffFile["status"] = "modified";
    for (const line of lines) {
      if (line.startsWith("new file")) {
        status = "new";
        break;
      }
      if (line.startsWith("deleted file")) {
        status = "deleted";
        break;
      }
    }

    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines) {
      const hunkMatch = line.match(
        /^@@\s+\-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)/,
      );
      if (hunkMatch) {
        currentHunk = {
          header: `−${hunkMatch[1]} +${hunkMatch[2]}${hunkMatch[3] || ""}`,
          lines: [],
        };
        hunks.push(currentHunk);
        oldLine = parseInt(hunkMatch[1], 10);
        newLine = parseInt(hunkMatch[2], 10);
        continue;
      }

      if (!currentHunk) continue;

      if (line.startsWith("+")) {
        currentHunk.lines.push({
          type: "add",
          content: line.slice(1),
          newNum: newLine,
        });
        newLine++;
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({
          type: "remove",
          content: line.slice(1),
          oldNum: oldLine,
        });
        oldLine++;
      } else if (line.startsWith(" ")) {
        currentHunk.lines.push({
          type: "context",
          content: line.slice(1),
          oldNum: oldLine,
          newNum: newLine,
        });
        oldLine++;
        newLine++;
      } else if (line === "\\ No newline at end of file") {
        continue;
      }
    }

    if (path) {
      files.push({ path, status, hunks });
    }
  }

  return files;
}
