#!/usr/bin/env node
import { Command } from "commander";
import { addNote } from "../commands/add.js";
import { listNotes } from "../commands/list.js";
import { deleteNote } from "../commands/delete.js";

const program = new Command();

program
  .name("notes")
  .description("A small CLI for managing local notes.");

program
  .command("add <title>")
  .description("Create a new note with the given title.")
  .option("-b, --body <body>", "note body text")
  .action((title: string, opts: { body?: string }) => {
    addNote(title, opts.body ?? "");
  });

program
  .command("list")
  .description("List all notes.")
  .action(() => {
    listNotes();
  });

program
  .command("delete <id>")
  .description("Delete the note with the given id.")
  .action((id: string) => {
    deleteNote(id);
  });

program.parse();
