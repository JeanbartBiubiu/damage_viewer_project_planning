---
name: secret-safe-local-file-processing
description: Use when transforming, extracting, cleaning, counting, or rewriting local files that may contain API keys, bearer tokens, cookies, refresh_token values, RT wrappers, credentials, or other secrets.
---

# Secret Safe Local File Processing

## Core Rule

Treat token-bearing local files as file-to-file work. Produce artifacts and counts, not secret values in chat, logs, memory, or docs.

## Workflow

1. Confirm the target paths and output path. Do not infer broad directories when the user names specific files.
2. Inspect only schema or shape first: field names, delimiters, counts, and sample key paths. Do not print secret values.
3. For destructive rewrites, create a backup beside the source file before changing it.
4. Parse with structured tools when possible, such as `ConvertFrom-Json` for JSON. For delimited text, split fields first and operate only on the token field.
5. Write extracted secrets to the requested output file, one value per line unless the user requested another format.
6. Verify with counts and non-secret checks, such as files scanned, rows written, parse errors, empty values skipped, and wrapper delimiters remaining.
7. Final response reports paths, counts, backups, and parse errors only.

## Count-Limited Extraction

When the user asks for the first `N` values:

- sort candidate files deterministically by full path unless the user gives an order
- parse one file at a time and stop immediately after writing `N` values
- skip empty or missing fields
- preserve duplicates unless the user explicitly asks for de-duplication
- treat parse errors as counted failures; continue unless the user asked for strict all-or-nothing behavior
- report `files_scanned`, `files_with_secret`, `written`, `skipped_empty`, and `parse_errors`

## Wrapper Cleanup

Common wrapper examples must use placeholders, never real values:

- `account----rt----<secret>`: split on the delimiter, keep only the secret-side field
- `<prefix>----rt----<secret>`: remove the wrapper from the token-side field only
- JSON wrappers such as `{ "refresh_token": "<secret>" }`: parse JSON and write only the field value

If the wrapper shape is ambiguous, inspect one redacted shape first and avoid rewriting until the token field is identified.

## Safe Outputs

- output file path
- number of records scanned, written, skipped, and failed
- field path used, such as `accounts[*].credentials.refresh_token`
- whether backup files were created
- whether known wrappers or delimiters remain

## Unsafe Outputs

- full tokens, cookies, API keys, passwords, or bearer strings
- copied source lines that contain secrets
- screenshots or logs containing secret values
- Codex Memory or Obsidian entries containing secret material

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Searching the whole line for `rt` | Split into fields, then inspect the token side only. |
| Guessing JSON layout | Read one representative schema shape first, with values redacted. |
| Rewriting without backup | Create a `.bak` before destructive cleanup. |
| Answering with extracted tokens | Write them to a file and report count/path only. |
