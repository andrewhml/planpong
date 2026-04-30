import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const NOTES_DIR = join(homedir(), ".notes");

export function addNote(title: string, body: string): void {
  if (!existsSync(NOTES_DIR)) {
    mkdirSync(NOTES_DIR, { recursive: true });
  }
  const id = Date.now().toString(36);
  const path = join(NOTES_DIR, `${id}.md`);
  const content = `# ${title}\n\n${body}\n`;
  writeFileSync(path, content);
  console.log(`created ${id}: ${title}`);
}
