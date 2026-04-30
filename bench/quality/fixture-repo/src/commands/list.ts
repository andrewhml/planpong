import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const NOTES_DIR = join(homedir(), ".notes");

export function listNotes(): void {
  if (!existsSync(NOTES_DIR)) {
    console.log("(no notes yet)");
    return;
  }
  const files = readdirSync(NOTES_DIR).filter((f) => f.endsWith(".md"));
  if (files.length === 0) {
    console.log("(no notes yet)");
    return;
  }
  for (const f of files) {
    const id = f.replace(/\.md$/, "");
    const content = readFileSync(join(NOTES_DIR, f), "utf-8");
    const firstLine = content.split("\n")[0].replace(/^#\s+/, "");
    console.log(`${id}\t${firstLine}`);
  }
}
