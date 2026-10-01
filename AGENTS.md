## Routed rules

- Before changing production code, tests, manifests, dependencies, generated layout, or source ownership, read `rules/implementation.md`.

## Git conventions

- Work directly on `main` in this checkout by default. Use another branch or worktree only when the user explicitly requests it.
- Use emoji-prefixed conventional commits: `<emoji> <type>(<scope>): <subject>`.
  - ✨ feat · 🩹 fix · ♻️ refactor · 🔧 chore · 🎨 style · ⚡ perf · ✅ test · 🏗️ build · 🚦 ci · ⏪ revert · 📝 docs
- Commit when a task goal is achieved, then verify `git status --short` is clean.

## Subagent preferences

- Use `gpt-6.1-sol` with `high` reasoning for subagents by default.
- Use `gpt-6-astra` with `high` reasoning for challenging subagents.

## Project authority

- Intent: `project-doc/INTENT.md`; its confirmation state is recorded in `project-doc/_scratch.md`.
- Logical design contracts: `project-doc/design/`.
- Implementation discussion and settled decisions: `project-doc/implementation/`.
- Realized implementation and empirical evidence: production code, tests, manifests, and generated artifacts.
- The user requested bootstrap before intent confirmation. Treat the current intent as a draft until its recorded confirmation state changes.
- Bootstrap member names and paths are provisional; design establishes logical architecture and source ownership.
