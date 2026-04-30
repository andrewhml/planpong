import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const NOTES_DIR = join(homedir(), ".notes");

export function deleteNote(id: string): void {
  const path = join(NOTES_DIR, `${id}.md`);
  if (!existsSync(path)) {
    console.error(`no note with id ${id}`);
    process.exit(1);
  }
  unlinkSync(path);
  console.log(`deleted ${id}`);
}
