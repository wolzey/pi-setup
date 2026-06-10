---
name: obsidian
description: Create, read, search, tag, and organize notes in Ethan's local Obsidian vault. Use when the user asks to search/read Obsidian notes, use Obsidian as context, create or edit documentation/notes, manage daily notes, tags, folders, or wikilinks.
argument-hint: "<action> [arguments]"
---

# Obsidian Vault Manager

Manage notes in the Obsidian vault located at:

```text
/Users/ethanwolz/Documents/Wolzey
```

Use this skill when the user wants Obsidian context or note/documentation management. If invoked without a specific action, show the usage guide below.

## Actions

### `create` - Create a new note

```text
/skill:obsidian create <title> [--folder <folder>] [--tags <tag1,tag2,...>] [--content <content>]
```

- Create a markdown file at `<vault>/<folder>/<title>.md`, or `<vault>/<title>.md` when no folder is provided.
- If `--folder` specifies a folder that doesn't exist, create it.
- If `--tags` are provided, add YAML frontmatter with tags.
- If `--content` is provided, use it as the note body. Otherwise, start with a `# <title>` heading and empty body.
- If the user provides content conversationally, use that as the body.
- Always confirm the created file path.

Frontmatter format when tags are present:

```yaml
---
tags:
  - tag1
  - tag2
---
```

### `read` - Read a note

```text
/skill:obsidian read <title or path>
```

- Search for the note by title, case-insensitive and partial-match friendly.
- If multiple matches exist, list them and ask which one.
- Display the full note content.

### `edit` - Edit an existing note

```text
/skill:obsidian edit <title or path>
```

- Find and read the note, then ask what changes the user wants unless the requested edit is already clear.
- Preserve existing frontmatter and structure.
- Use the `edit` tool for targeted changes.

### `search` - Search notes

```text
/skill:obsidian search <query> [--folder <folder>] [--tags <tag>]
```

- Search note filenames and content for the query.
- If `--folder` is specified, limit search to that folder.
- If `--tags` is specified, search for notes containing those tags in frontmatter.
- Display matching notes with snippets.
- Sort by usefulness: title matches first, then content matches.

### `list` - List notes

```text
/skill:obsidian list [folder] [--tags <tag>]
```

- If a folder is given, list notes in that folder.
- If no folder is given, list top-level notes and folders.
- If `--tags` is specified, filter to notes with those tags.
- Show note titles and last modified dates.

### `tag` - Manage tags on a note

```text
/skill:obsidian tag <title> --add <tag1,tag2>
/skill:obsidian tag <title> --remove <tag1>
/skill:obsidian tag <title> --list
```

- Add, remove, or list tags on a note.
- Tags are stored in YAML frontmatter.
- If the note has no frontmatter, create it when adding tags.
- If removing the last tag, remove the frontmatter entirely.

### `move` - Move a note to a different folder

```text
/skill:obsidian move <title> --to <folder>
```

- Move the note file to the target folder.
- Create the folder if it doesn't exist.
- Update any `[[wikilinks]]` in other notes that reference this note.

### `folders` - List all folders

```text
/skill:obsidian folders
```

- List all folders in the vault with note counts.

### `recent` - Show recently modified notes

```text
/skill:obsidian recent [count]
```

- Default to 10 most recently modified notes.
- Show title, folder, and last modified time.

### `daily` - Create or open today's daily note

```text
/skill:obsidian daily [--content <content>]
```

- Daily notes go in `<vault>/Daily`.
- Filename format: `YYYY-MM-DD.md`.
- If today's note exists, read it. If `--content` is provided, append to it.
- If it doesn't exist, create it with a `# YYYY-MM-DD` heading and optional content.
- Add frontmatter tag `daily`.

### `link` - Find related notes

```text
/skill:obsidian link <title>
```

- Find the note and extract key terms from its content.
- Search other notes for those terms.
- Suggest `[[wikilinks]]` to related notes.

### `tags` - List all tags used in the vault

```text
/skill:obsidian tags
```

- Scan all notes for YAML frontmatter tags.
- Display each unique tag and the count of notes using it.

## Tooling Guidelines

- Prefer Pi file tools for file content operations:
  - `read` to read known files.
  - `write` to create new notes.
  - `edit` to make precise changes.
  - `bash` with `find`/`rg` for discovery and search.
- Always use absolute paths under `/Users/ethanwolz/Documents/Wolzey`.
- Never read, search, or modify anything inside the `.obsidian/` configuration directory.
- Never expose secrets if notes contain private credentials or tokens; summarize or redact instead.
- When searching, be fuzzy and helpful — if the user says "read automation", find notes with "automation" in the title or content.
- Preserve existing note content and formatting when editing.
- Preserve `[[wikilinks]]`; never convert them to standard markdown links.
- Preserve checkboxes: `- [ ]` and `- [x]`.
- Use `[[wikilinks]]` syntax for internal links.
- Use nested tags with `/` separators, e.g. `project/otto`, `status/active`, `type/braindump`. Do not include `#` prefixes in frontmatter tags.
- File names should be descriptive and title-cased, e.g. `Architecture Overview.md`.
- When creating notes from conversation, format them cleanly as markdown.
- If the user's request is ambiguous, show what you found and ask for clarification.
- Dates should use ISO format: `YYYY-MM-DD`.

## Usage

```text
Obsidian Vault Manager — /skill:obsidian <action> [args]

  create <title>    Create a new note (--folder, --tags, --content)
  read <title>      Read a note by title (fuzzy match)
  edit <title>      Edit an existing note
  search <query>    Search notes by content or title (--folder, --tags)
  list [folder]     List notes and folders (--tags)
  tag <title>       Manage tags (--add, --remove, --list)
  move <title>      Move note to folder (--to)
  folders           List all vault folders
  recent [n]        Show n most recent notes (default 10)
  daily             Create/open today's daily note
  link <title>      Find related notes
  tags              List all tags in the vault

Vault: ~/Documents/Wolzey
```
