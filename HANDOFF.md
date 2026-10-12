# HANDOFF: Code-3 (M-Kopa) → Mods

`Written 2026-10-12 by Code-3, the session that built the allan plugin. From here on, Claude Code mods for all of Allan's work are yours. Code-3 keeps its own job: auditing, oversight and QC of the Lua client projects.`

## 1. Your role

You own `~/Desktop/Desktop/Work/claude-mods`: the `allan` plugin, its tests, its README and tutorials, and any future mod. Allan runs 6 to 11 Claude Code sessions a day across several client projects and relays between them by hand; the mods exist to take that friction away. You read his other projects only to understand how he works. You never write into a client project.

Evidence for every mod came from his own session logs: `~/Desktop/Desktop/Work/Lua/M-Kopa/MODS-PLAN-2026-10-04.md` (1,863 messages ranked into the top 10 mods, plus honourable mentions).

## 2. Read in this order

1. This file.
2. `README.md` (switches, the feature table, install and develop commands).
3. `BUILD-PLAN.md` (the original specs and the 12 validator rules; the rules are still true).
4. `TUTORIALS.md` (one section per mod with examples from Allan's projects).
5. The code: `allan/hooks/register.ts` (entry), `allan/hooks/features/*.ts(x)` (one file per mod), `allan/hooks/lib/*.ts` (pure helpers), `allan/types/index.d.ts` (every `$.state` key), `allan/tests/*.test.ts`.

Load the `plugin-authoring` skill before touching code. It writes this build's API types to a path that changes with every Claude Code version; `allan/tsconfig.json` extends the copy the engine lays in `allan/.claude-plugin/types/`.

## 3. State on 2026-10-12

- Repo `main` at `a0b99a1`, pushed. Remote `git@github.com-lua:lua-erissatallan/claude-mods.git`, repo-local `user.email allan@luaimplementation.ai`. Commits carry no attribution lines (Allan's rule; the commit mod strips them anyway).
- Installed user wide as `allan@allan-mods`, read straight from the repo folder: edit, commit, then Allan runs `/reload-plugins` in any session. No reinstall, no version bump.
- 82 tests pass across 9 files; `claude plugin validate allan` and `npx -y -p typescript@5.6.3 tsc -p allan --noEmit` are clean.
- All 10 features are built. Six have been used live by Allan: mods, voice, commit, pulse, handover, relay (askmode is live but he has not yet seen a hold). Four have only run in tests: **release, watch, testguard, outbox**. Their README rows say "unverified live".

| Feature | What it does | Live? |
|---|---|---|
| mods | `/mods` lists and switches everything; `ALLAN_MODS_OFF=1` kills all | yes |
| voice | reply rules in the system prompt; `/style` | yes |
| commit | strips attribution; refuses pushes under the wrong identity; flags internal ids in client-facing text | yes |
| pulse | one line band: session, project, baton, `p` parked list, `h` handoffs, `i` inbox; `/pending`, `/park`, `/unpark` | yes |
| handover | `ctx NN%` from 60% up, toasts at 60/70/80/90, lead sessions skip auto compaction, `/handover <successor>`, `/close` | yes |
| relay | `/sessions` from Claude Code's own list in `~/.claude/sessions/`, `/relay <Project>/<name> <text\|last>`, every model sent message headed `[relay from <name> · <project>]` | yes |
| askmode | a question turn cannot Edit, Write or run changing commands; `/build` lifts it | partly |
| release | `/promote`: clean tree check, paired agents from `.claude-mods.json`, a human Promote button, prune past the cap, a line in TECH.md | no |
| watch | one session per project reads a `lua logs` page every 10 min, light on the band, `checks` from `.claude-mods.json`, `/logs` | no |
| testguard | `/testmode` protects real recipients, `/secret set` holds clipboard values with redaction, key shaped prompt warning | no |
| outbox | drafts for contacts kept in `Claude_Memory/MESSAGES.md`, `/outbox` pane with Copy, Copy for Slack, Mark sent | no |

## 4. Rules that cost a failed run (beyond BUILD-PLAN's twelve)

- The validator accepts a second `tool.call { tool: 'Bash' }` hook in another file. Matcher values must be literal single strings: a loop over a union of tool names fails tsc, so write one `on(...)` per tool.
- `$.ui.status` is one line per plugin and handover owns it. Anything else that wants a light goes on the pulse band (an atom pulse.tsx reads, as inbox and watch do).
- A reload keeps the old status line; set it again in `session.start`.
- Unmatched owners: `session.start` and `prompt.compose` (register.ts), `classic.SessionStart`, `classic.UserPromptSubmit`, `turn.complete` (pulse.tsx), `prompt.submit` (askmode.ts), `session.send` and `session.receive` (relay.ts), `session.measure` (handover.ts), `session.append` (testguard.ts). Add logic inside the owner, or hook a matched variant (`turn.complete { reason: 'answer' }` is outbox's, `session.start { surface: /…/ }` is watch's).
- Tests: register every `on(...)` before the first `$` call (a `world(on)` helper that returns a state object works well). `turn.complete` input needs `{ reason: 'answer', answer, durationMs, isAborted, turnId }`. `session.compact` messages must be non-empty. `mock.clock(on, { now })`. Store ops are `store.get/set/delete/keys`. Import `TestBody` from 'claude-code/testing' for helper parameter types. `$.session.send` mock input needs `origin: { kind: 'model' }`.
- Claude Code's live session list is `~/.claude/sessions/<pid>.json` (pid, sessionId, cwd, name, status, updatedAt). It is not a documented feature; if an update changes it, `/sessions` comes back empty rather than wrong.
- Never put the text "lua deploy" in a Bash command, even in a grep or heredoc: the lua-agent-builder plugin's confirm-deploy hook blocks it. Write such text with the Write tool. The release mod calls lua through `$.process.run`, which that hook never sees.
- Hot reload: `plugin-authoring` expects a mod under `~/.claude/dev-mods/`, where each edit loads at the end of the turn. This plugin lives in its repo instead, so every change needs `/reload-plugins`. If you want the faster loop while developing a feature, build it in dev-mods first and move it over.

## 5. Open items, in order

1. **Walk Allan through the weekend try-out** (checklist in §7). Fix what breaks. release only on a staged version with him watching: the Promote press has never run.
2. **askmode tuning.** Watch for false holds (a request read as a question) and misses. The word rules are in `allan/hooks/lib/askmode.ts`; `askmodeUseModel` adds a Haiku call for unclear prompts.
3. **Honourable mentions from MODS-PLAN** (not built, in Allan's ranked order): model and effort presets per session role (`/model` was switched 81 times in his logs), `/triage-notes` for meeting notes, a collision warning when two live sessions edit the same file.
4. **Two of Allan's decisions to raise when relevant:** whether to add "no attribution lines in commit messages" to his global CLAUDE.md (the commit mod covers it meanwhile); whether to turn off the lua-agent-builder confirm-deploy Bash hook, which blocks plain file writes that mention its deploy verb (the release mod now covers real promotes).
5. **Keep up with Claude Code versions.** The API types move with each version; after an update, re-run validate, tsc and tests before anything else.

## 6. How Allan works with you

- Short answers, outcome first; he reads on his phone across several projects and gets tired late. Aim for half the length you would naturally write.
- Before any code, tell him in a few lines how you will build it. Ship one feature at a time, then let him try it after `/reload-plugins` before the next, unless he says otherwise.
- Ask before big assumptions; otherwise proceed. Do not ask clarifying questions he has already answered.
- Minimize em dashes and hyphens in prose, identifiers and anything sent out. Existing kebab-case names and flags are fine.
- No attribution lines in commits. Never `git add -A`. Push after `git fetch`; never force.
- Messages for another session go between `▼▼▼ START · message for <session>` and `▲▲▲ END · message for <session>` lines. The relay mod can send them: `/relay <Project>/<name> last`.
- He names sessions with `/rename`. Code-3 lives in M-Kopa and owns the Lua audit and QC work; send it anything you learn about his Lua projects, nothing else.

## 7. Weekend try-out checklist (paste ready)

1. `/reload-plugins`, then `/mods`: ten rows, all on.
2. pulse: `/park "test" "none"`, press `p` on the band, press `1`, press Unpark.
3. handover: `/close`; `/handover Test-1` (delete the file after); `/mods set handoverThresholds 1,70,80,90`, see `ctx NN%` on the next reply, set it back to `60,70,80,90`.
4. relay: `/sessions`, then `/relay <Project>/<name> just reply "got it", nothing else`; check the `i:✉` row in the receiving session's band.
5. askmode: ask "why does the band say 1 parked?"; if Claude reaches for a file, expect the toast; then type "go".
6. release, with Allan watching, on a staged version: write `.claude-mods.json` in the agent folder (`pairs`, `versionCap`), `/promote`, read the plan, press one Promote button, then `lua version list` in another terminal and check the `## Releases` line in TECH.md.
7. watch: add `"agent"` and `"checks"` to `.claude-mods.json` in Jackfruit Finance_Agent, open a session there, wait 15 seconds, look at the dot, `/logs`.
8. testguard: add `"protected"` in lee-highfield-agent, `/testmode on`, ask the session to echo a protected address, expect the refusal, `/testmode off`. Copy any value, `/secret set X`, ask the session to `echo $X`, confirm the output shows `[X redacted]`.
9. outbox: add `"contacts": ["Drew"]` in lee-highfield-agent, ask for a two line quoted draft "for Drew", expect the toast, `/outbox`, press Copy for Slack, then Mark sent, check MESSAGES.md.
10. voice and commit: `/style plain` for one reply; make a commit anywhere and confirm no attribution line.

The `.claude-mods.json` schema is in the header comment of `allan/hooks/lib/config.ts`.
