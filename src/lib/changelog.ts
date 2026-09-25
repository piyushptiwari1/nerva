import changelogRaw from "../../CHANGELOG.md?raw";

/**
 * Parsed view of CHANGELOG.md (bundled at build time). One source of truth
 * for the in-app "What's new" dialog and the GitHub release body.
 */
export interface ChangelogSection {
  heading: string; // "New" | "Fixed" | "Changed" | …
  items: string[];
}

export interface ChangelogEntry {
  version: string; // "0.1.12"
  date: string | null;
  sections: ChangelogSection[];
}

export function parseChangelog(md: string = changelogRaw): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let cur: ChangelogEntry | null = null;
  let sec: ChangelogSection | null = null;
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    const v = /^## v(\d+\.\d+\.\d+)(?:\s+—\s+(\S+))?/.exec(line);
    if (v) {
      cur = { version: v[1], date: v[2] ?? null, sections: [] };
      sec = null;
      entries.push(cur);
      continue;
    }
    if (!cur) continue;
    const h = /^### (.+)/.exec(line);
    if (h) {
      sec = { heading: h[1].trim(), items: [] };
      cur.sections.push(sec);
      continue;
    }
    const b = /^- (.+)/.exec(line);
    if (b && sec) sec.items.push(b[1]);
  }
  return entries;
}

export function changelogFor(version: string): ChangelogEntry | null {
  return parseChangelog().find((e) => e.version === version) ?? null;
}

/** Strip markdown bold markers for plain rendering. */
export function plain(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");
}

export const GITHUB_REPO = "https://github.com/piyushptiwari1/nerva";
export const WEBSITE = "https://nerva.bytical.ai";
