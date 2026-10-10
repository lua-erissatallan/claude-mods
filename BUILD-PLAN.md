# Plan: build the remaining 7 mods (handed to Code-3)

## Context

Allan asked for Claude Code mods built from his own session logs (1,863 messages, ranked in
`M-Kopa/MODS-PLAN-2026-10-04.md`). Code-2 built and shipped 3 of 10: **voice**, **commit**,
**pulse** (with hotkey buttons and a detail pane), all in one plugin `allan`, installed user wide
and switchable with `/mods`. Code-2 is at 75% context, so the remaining 7 go to its successor
**Code-3**: handover, relay, askmode, release, watch, testguard, outbox.

Outcome: all 10 features live in `allan`, each with its own on/off row, each tested, and Allan
using them across sessions.

## Where things stand

- Repo `~/Desktop/Desktop/Work/claude-mods` (remote `git@github.com-lua:lua-erissatallan/claude-mods.git`,
  repo-local `user.email allan@luaimplementation.ai`), last commit `a747d69`, 20 tests passing.
- Installed: `allan@allan-mods`, user scope, **read from the repo folder** (`claude plugin list`
  says `Read from: …/claude-mods/allan`). Edit, commit, then `/reload-plugins` in any session;
  no reinstall, no version bump.
- Files: `allan/hooks/register.ts` (entry), `hooks/features/{mods,voice,commit}.ts`,
  `hooks/features/pulse.tsx`, `hooks/lib/{switch,project,memory}.ts`, `types/index.d.ts`,
  `tests/{register,pulse}.test.ts`, `.claude-plugin/plugin.json` (userConfig), `README.md`.

## Hard-won rules (the engine's validator enforces these; each cost a failed run)

1. **One plugin, one feature file per mod.** Add a feature by: userConfig fields in
   `plugin.json` (`<feature>` boolean default true, plus its settings), an entry in `FEATURES`
   in `lib/switch.ts` (drives `/mods`), its command specs registered in `register.ts`'s
   `session.start`, and `try { feature(on, options) } catch {}` in `register.ts`.
2. **An event may be hooked only once per plugin without a matcher.** Already taken, unmatched:
   `session.start` and `prompt.compose` (register.ts), `classic.SessionStart`,
   `classic.UserPromptSubmit`, `turn.complete` (pulse). A new feature needing one of these either
   adds its logic in the owning file or hooks with a matcher (`session.start {isInteractive:true}`
   is pulse's; a second identical matcher is untested). Matched hooks (`tool.call {tool}`,
   `command.run {command}`, `ui.render {component}`) can coexist.
3. **`$` may only be passed to functions declared in the same file.** Helpers in `lib/` must be
   pure (data in, data out). That is why `findProject` is copied into each feature file.
4. **State atoms must be declared in the file that reads/writes them**, as
   `atom({ plugin: 'allan', key: '<k>' } as const, initial)`, and every key declared in
   `types/index.d.ts` `PluginState.allan`. Two files may declare atoms for the same key.
5. **Never name a variable `h` (the JSX factory) or shadow `next`.** Both broke silently.
6. **No `import()`**; files are `.ts`/`.tsx` ES modules.
7. **A `/config` change reloads the plugin** mid-command: reply first, `void $.config.set(...)`.
8. **Guards fail open**: every gating `tool.call` gets `.catch(($, e, next) => next(e))`.
9. **Tests:** register every `on(...)` before the first `$` call; answer bottom events yourself
   (`session.start` → `({ cwd: e.cwd })`, `command.register`, `ui.open` → `{ value: { isPlaced: true } }`,
   `classic.<Event>`); raise classic events with `$.classic.UserPromptSubmit({...})`;
   `process.run` mocks need `isStdoutTruncated`, `isStderrTruncated`; `command.run` input needs
   `origin` and `presentation` (cast `as never`); `$.ui.mount` needs full props (Pane: `title,
   isFocused, bodyColumns, placement, scroll: { offset, bodyRows }`); press Buttons by their `key`.
10. **Types file moves with each Claude Code version.** Load the `plugin-authoring` skill first;
    it writes `…/bundled-skills/<version>/<hash>/plugin-authoring/types/claude-code.d.ts`. Type
    check with a tsconfig kept outside the mod (see the types file header), including that file
    plus `allan/hooks`, `allan/types`, `allan/tests`.
11. **The `lua-agent-builder` confirm-deploy hook blocks any Bash text containing "lua deploy"**,
    even in heredocs and greps: write such files with the Write tool.
12. **Commits carry no attribution lines.** Allan bans them; `commit` strips them anyway.

## Build order and specs (each: validate, tsc, tests incl. one proving `<feature>: false` passes everything, commit, push, Allan tries it)

**1. handover** (highest daily value). `session.measure` (sole owner): status line `ctx 64%`,
toasts at `handoverThresholds` (default `60,70,80`), each once per session. `session.compact`
`{ trigger: 'auto' }`: if the session name (atom `allan.session`, written by pulse) matches
`handoverLeadPattern` (default `^(Orchestrator|Lead|Code)`) and `handoverBlockAutoCompact` is on,
return `{ skip }` and toast "auto compaction skipped; /handover or /compact". `/handover
<successor>`: write `Claude_Memory/HANDOVER_<successor>.md` from a template (sections: work done,
learnings and gotchas, pending items, how to start), add the successor to HANDOFFS `## Surfaces`
if a table exists, return the kickoff prompt wrapped in `▼▼▼ START · message for <successor>` /
`▲▲▲ END` lines with the cwd, and `$.ui.copy` it. Fill the template's content by asking the
model: `$.model.fork({ prompt })` over this transcript (cache friendly) with "write the handover
sections"; fall back to an empty template with headings if the fork is not answered. `/close`:
checks `git status --porcelain` clean, INDEX/HANDOFFS modified today, ⏳ Parked has no line from
this session older than 7 days; prints a checklist and "safe to close" or what is missing.

**2. relay.** Registry: in pulse's `classic.SessionStart`/`UserPromptSubmit` hooks, also write
`$.store` key `sessions` (map of session id → `{ name, project, cwd, lastSeen }`; `$.session.id()`).
`/sessions` lists live ones (lastSeen < 12h). `/relay <name> <text|last>`: `last` = the most recent
START/END block in this session's last reply (`$.session.messages()`); wrap with sender name and
project; `$.session.send({ to: name, text })`; on refusal or not delivered, `$.ui.copy` the block
and say so. Incoming: `session.receive` (sole owner) records `{ from, at, preview }` into atom
`allan.inbox`; pulse's band renders an inbox row with a `Clear` button (extend pulse.tsx).

**3. askmode.** `prompt.submit` (sole owner): heuristic first (ends with `?`; starts with
"quick question", "question", "why", "what", "how", "can you explain"; contains "no code change",
"don't change", "just a question"); if unclear and `askmodeUseModel`, `$.model.classify` with
haiku. Mark the turn in atom `allan.askTurn`. Guard: Edit, Write, NotebookEdit and mutating Bash
(`lua (push|deploy|env -k|version (create|promote))`, `git (commit|push)`, `vercel`, `rm `) refused
with "This turn is a question; reply 'go' or /build to allow changes." `/build` clears the mark.
Clear on `turn.complete` (pulse owns it: add one line there, or use a matched variant).
Tool hooks: if a second `tool.call {tool:'Bash'}` in another file is rejected by the validator,
**consolidate all tool guards into `features/guards.ts`** (commit, askmode, testguard each
exposing pure check functions; git lookups via `$.process.run` live in guards.ts).

**4. release.** `/promote`: read `lua version list --json` via `$.process.run` (cwd = project),
refuse if `git status --porcelain` is not empty, read pairs from `<project>/.claude-mods.json`
(`{ "pairs": ["../other-agent"], "versionCap": 95 }`), open a pane listing current → next version
for each agent with a **Promote** Button (human press only; never `tool.check` ask) that runs the
promote with `LUA_DEPLOY_CONFIRMED=1` in `process.run` env, prunes the oldest version past the cap
(verify the delete command with `lua version --help` first), appends a dated line to
`Claude_Memory/TECH.md`. Runs through `$.process.run`, so the plugin's confirm-deploy Bash hook
does not interfere. Verify only with Allan present on a staged version.

**5. watch.** Per project, while a session there is open: `$.clock.every(intervalMin)` started in
a matched `session.start`; a lease in `$.store` (`watch:<project>` = session id + expiry) so one
session watches each project. Pull `lua logs --ci --json --limit 100` pages since the stored
watermark (dedupe on `id`), count `agent_error`, `Preprocessor result {"action":"block"…}`,
lines with `fail open|GATE BYPASSED`; compare to a 7 day median kept in `$.store`; status line
dot (green/amber/red) and a toast on amber/red. Optional `checks` in `.claude-mods.json`
(commands for Neon and canary; non-zero exit = red). `/logs` prints the summary since last seen.

**6. testguard.** Protected recipients from `.claude-mods.json` (`protected: ["drew@…", "kiri@…"]`).
While `/testmode on` (atom) or env `ALLAN_TESTMODE=1`: refuse Bash whose command or referenced
script file names a protected address; refuse `lua env … -k` for keys matching
`/(CC|ALLOWLIST|RECIPIENT|TO)$/`. `/secret set <NAME>` reads the value from the clipboard
(`pbpaste` via `$.process.run`), stores it in session state only, rewrites Bash calls that use
`$NAME` to inject it via env, and redacts the value from tool results through `session.append`
(sole owner). Prompt containing a key shaped string (`/(sk|am|lua)_[A-Za-z0-9]{16,}/`) gets a
warning toast (inside askmode's `prompt.submit` owner).

**7. outbox.** On `turn.complete` (inside pulse's owner hook or a matched variant), find
START/END blocks or drafts addressed to a contact in `.claude-mods.json` `contacts`, append to
`Claude_Memory/MESSAGES.md` as `draft` with date and session. `/outbox` pane: each draft with
Buttons Copy, Copy for Slack (markdown tables to aligned text), Mark sent. Toast at session start
for drafts older than a day. Every copy reminds: re-read live state before sending (Allan's
freshness rule).

## Verification

- Per feature: `claude plugin validate allan` passes; tsc clean; `claude plugin test allan` green
  including a `<feature>: false` pass-through test; then `/reload-plugins` and a live try by Allan.
- `/mods` lists all 10 features; `/mods off <f>` silences each one.
- `ALLAN_MODS_OFF=1 claude`: nothing registers.
- release and testguard are exercised live only with Allan present.

## Handoff mechanics (done by Code-2 after approval)

1. Write `M-Kopa/Claude_Memory/HANDOVER_Code-3.md`: points at this plan
   (`~/.claude/plans/curried-wishing-newell.md`), `MODS-PLAN-2026-10-04.md`, the repo, the rules
   above, plus M-Kopa's other open threads (the ⏳ Parked list).
2. Update `M-Kopa/Claude_Memory/INDEX.md`: baton to Code-3; Parked line for the mods build.
3. Commit M-Kopa (no attribution).
4. Give Allan the Code-3 kickoff prompt between START/END markers.
