export interface JsonLine {
  raw: string;
  parsed?: unknown;
}

/** Best-effort JSON.parse of a single line; never throws. */
export function parseJsonLine(line: string): JsonLine {
  const raw = line.trim();
  try {
    return { raw, parsed: JSON.parse(raw) };
  } catch {
    return { raw };
  }
}
