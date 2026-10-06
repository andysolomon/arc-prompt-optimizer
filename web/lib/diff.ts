/**
 * Port of `lineDiffSummary` from the repository's `src/extension/review.ts` (which depends on Pi types the
 * web app does not ship). Logic is unchanged.
 */

/** Above this many DP cells the diff falls back to a multiset line match (still exact for most edits). */
const MAX_LCS_CELLS = 4_000_000;

export interface LineDiffSummary {
  readonly added: number;
  readonly removed: number;
  readonly unchanged: number;
  readonly summary: string;
}

function splitLines(text: string): string[] {
  return text === "" ? [] : text.split(/\r?\n/u);
}

function lcsLength(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  if (left.length * right.length > MAX_LCS_CELLS) {
    const counts = new Map<string, number>();
    for (const line of left) counts.set(line, (counts.get(line) ?? 0) + 1);
    let common = 0;
    for (const line of right) {
      const count = counts.get(line) ?? 0;
      if (count > 0) {
        common += 1;
        counts.set(line, count - 1);
      }
    }
    return common;
  }
  let previous = new Uint32Array(right.length + 1);
  let current = new Uint32Array(right.length + 1);
  for (const leftLine of left) {
    for (let column = 1; column <= right.length; column += 1) {
      current[column] =
        leftLine === right[column - 1] ? previous[column - 1]! + 1 : Math.max(previous[column]!, current[column - 1]!);
    }
    [previous, current] = [current, previous];
  }
  return previous[right.length]!;
}

/** Line-level diff counts between the source prompt and a candidate. */
export function lineDiffSummary(source: string, candidate: string): LineDiffSummary {
  const sourceLines = splitLines(source);
  const candidateLines = splitLines(candidate);
  let prefix = 0;
  while (prefix < sourceLines.length && prefix < candidateLines.length && sourceLines[prefix] === candidateLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < sourceLines.length - prefix &&
    suffix < candidateLines.length - prefix &&
    sourceLines[sourceLines.length - 1 - suffix] === candidateLines[candidateLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const middle = lcsLength(
    sourceLines.slice(prefix, sourceLines.length - suffix),
    candidateLines.slice(prefix, candidateLines.length - suffix),
  );
  const unchanged = prefix + suffix + middle;
  const added = candidateLines.length - unchanged;
  const removed = sourceLines.length - unchanged;
  return Object.freeze({ added, removed, unchanged, summary: `+${added} -${removed} lines` });
}
