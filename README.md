# claude-mods

Allan's Claude Code mods, built from his own session logs (see `M-Kopa/MODS-PLAN-2026-10-04.md`).
One plugin, `allan`, with one feature per mod. Every feature can be switched on or off.

## Switching

| Want to | Do |
|---|---|
| See every feature and its state | `/mods` |
| Turn one off or on | `/mods off <feature>` · `/mods on <feature>` |
| Change a setting | `/mods set <field> <value>` (for example `/mods set commitIdentity warn`) |
| Same, by menu | `/config`, rows named `allan.<field>` |
| Turn the whole plugin off | `/plugin disable allan@allan-mods` |
| Emergency: start with nothing loaded | `ALLAN_MODS_OFF=1 claude` |
| Ask Claude | "turn off watch": it runs `/mods off watch` or sets `pluginConfigs.allan.watch` to false in `~/.claude/settings.json` |

Guards fail open: if a mod's own code breaks, the call it was checking goes ahead.

## Features

| Feature | Status | What it does | Fields |
|---|---|---|---|
| mods | built | `/mods` lists and switches everything | |
| voice | built | Keeps Allan's reply rules in the system prompt (survives compaction); `/style normal \| plain \| visual` per session | `voice`, `voiceStyle` |
| commit | built | Strips Claude attribution from commits and PRs; refuses a push that would leave through a non `github.com-lua` remote or a non work email; flags internal ids (D12, H22, Claude_Memory) in PR text and in files under `docs/` or `Business_Documents/` | `commit`, `commitIdentity` (off/warn/block), `commitEmail`, `commitInternalIds` (off/warn/block) |
| pulse | built | Band above the prompt: session name, project, baton, parked count and oldest age (yellow when any is stale), handoffs addressed to this session's surface. The band is one line: `p` opens the parked list in a pane (a digit opens one item, with Unpark and `b` back), `h` opens the handoffs (`n` and `p` page). Press the key, or ctrl+x tab to the band first. `/pending` answers from INDEX and HANDOFFS with no model call; `/park "what" "next step"` and `/unpark <n>` write INDEX | `pulse`, `pulseStaleDays` |
| handover | built | Status line `ctx 64%` from the first threshold up (quiet below it); a toast the first time context crosses each threshold (the last says hand over now). Sessions named Orchestrator, Lead… or Code… skip auto compaction (manual `/compact` still works). `/handover <successor>` drafts `Claude_Memory/HANDOVER_<successor>.md` from this session's transcript (empty headings if the model does not answer), never overwrites without `--force`, and copies the START/END kickoff prompt. `/close` checks git is clean, INDEX and HANDOFFS were updated today, and nothing of yours is parked too long | `handover`, `handoverThresholds`, `handoverLeadPattern`, `handoverBlockAutoCompact` |
| relay | built | `/sessions` lists every open Claude Code session (read from Claude Code's own list in `~/.claude/sessions`, so names are the ones you gave with /rename), this project first, then the others by project. `/relay <name> <text\|last>` sends text, or the last START/END block of my last reply, headed `[relay from <me> · <project>]`; a bare name looks in this project first, `<Project>/<name>` reaches another, an unnamed session goes by the id /sessions shows, an ambiguous name is refused with the choices. Delivery is by session id; if it fails the message is copied to the clipboard. Relayed messages show in the pulse band (`i` opens them, with Clear) | `relay` |
| askmode | built | When a message only asks something (ends with `?`, starts with why/what/how/quick question, or says "no code change" / "just a question"), that turn cannot Edit, Write or run changing commands (`lua push/deploy/promote`, `lua env … -k`, `lua version create`, `git commit/push`, `vercel`, `rm`, `sed -i`); each hold shows a toast. A request ("can you fix X?", "go …") is never held. Reply `go` or `/build` to allow; the mark ends with the turn. Optional Haiku call for messages the rules cannot place | `askmode`, `askmodeUseModel` |
| release | next | `/promote` with clean tree check, paired agents, version cap pruning | |
| watch | planned | Background log, Neon and canary checks with a status light | |
| testguard | planned | Protected recipients during tests; `/secret` | |
| outbox | planned | Client message drafts kept in MESSAGES.md with copy buttons | |

## Install (all sessions)

    claude plugin marketplace add ~/Desktop/Desktop/Work/claude-mods
    claude plugin install allan@allan-mods

Edits to this folder reach every session on `/reload-plugins`.

## Develop

    claude plugin validate allan
    claude plugin test allan
