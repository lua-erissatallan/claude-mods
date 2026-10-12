# Allan's mods: tutorials

One section per mod. Each one says what the mod does, when you would reach for it, a worked example from one of your Lua projects, the exact commands, what you see, and how to switch it off. Every example is read from your project files as they were on 2026-10-12; names of sessions, versions and people are the real ones.

Two things apply everywhere:

- `/mods` lists the ten mods and their state. `/mods off <name>` and `/mods on <name>` switch one. `/mods set <field> <value>` changes a setting. `/reload-plugins` picks up a new build of the plugin.
- Guards fail open. If a mod's own code breaks, the thing it was checking goes ahead and the engine prints one dim line naming the mod.

Four mods read a small file at the root of a project, `.claude-mods.json`. One file covers release, watch, testguard and outbox:

```json
{
  "agent": "Customer_Qualification_Agent",
  "pairs": ["../jackfruit-lead-agent"],
  "versionCap": 95,
  "checks": { "canary": "node scripts/invariant-canary.mjs --quiet" },
  "protected": ["drew@leerealestate.com", "kiri@leerealestate.com"],
  "contacts": ["Drew", "Kiri", "Tihomir"]
}
```

Use only the fields a project needs. Each section below says which.

---

## 1. mods

**What it does.** `/mods` is the switchboard: it lists every mod with on or off and its settings, and switches them.

**When you reach for it.** A mod is in the way, or you want to check what is on in this session.

**Example.** In the M-Kopa session you want the context meter to shout earlier than 60 percent because you know the session will run long.

```
/mods
/mods set handoverThresholds 50,60,70,80
/mods off watch
/mods on watch
```

**What you see.** A list, one line per mod: `on   handover   handoverThresholds=50,60,70,80 …`. A change replies first, then reloads the plugin, so the new value is live on the next prompt.

**Switch off.** You cannot switch off `/mods` itself. `ALLAN_MODS_OFF=1 claude` starts a session with nothing loaded; `/plugin disable allan@allan-mods` turns the whole plugin off.

---

## 2. voice

**What it does.** Keeps your reply rules (answer first, half length, plain words, few dashes) in the system prompt, so they survive compaction and new sessions. `/style` changes the tone for one session.

**When you reach for it.** You are reading on your phone and want plain language, or you are reading a flow and want a small diagram.

**Example.** In Numida's Production workspace the Orchestrator session is explaining the escalation gating to you late at night.

```
/style plain
```

Later, when a Code session walks you through how the Luganda model comparison was run:

```
/style visual
/style normal
```

**What you see.** Nothing on screen at the moment of the command; the next reply changes. `plain` reads like an explanation to a bright student with every crucial detail kept. `visual` adds one small ASCII diagram (under 12 lines) before the prose when there is a flow or structure.

**Switch off.** `/mods off voice`. The default style for new sessions is `/mods set voiceStyle plain` or `normal` or `visual`.

---

## 3. commit

**What it does.** Strips Claude attribution lines from commits and PR text. Refuses a `git push` that would leave through a remote other than `github.com-lua` or under an email other than your work one. Flags internal memory ids in PR text and in files under `docs/` or `Business_Documents/`.

**When you reach for it.** You never reach for it; it runs on every commit and push.

**Example.** In `Jackfruit/Finance_Agent/jackfruit-topup-agent` a session commits a fix and pushes. The remote is `git@github.com-lua:lua-erissatallan/…` and `user.email` is `allan@luaimplementation.ai`, so the push goes through. In a fresh demo repo where the remote still points at your personal GitHub account the push is refused:

```
allan/commit: this push would leave under the wrong identity: remote is git@github.com:erissatallan/x.git (not github.com-lua). Fix the remote or user.email in /…/demo, or allow it with /mods set commitIdentity warn.
```

A session writing `docs/Voice_Feedback.md` for John Michael with a line like "see D12" gets a toast, because a client should never see a memory id.

**What you see.** Nothing when all is well. A toast for a warning. A refusal text from the tool for a block, which Claude reads and fixes.

**Switch off.** `/mods off commit`. Softer: `/mods set commitIdentity warn`, `/mods set commitInternalIds off`.

---

## 4. pulse

**What it does.** A one line band above the prompt: session name, project, the baton line from INDEX.md, parked items (yellow when any is older than 7 days), handoffs addressed to this session, relayed messages, and the watch light. `/pending`, `/park` and `/unpark` read and write INDEX.md with no model call.

**When you reach for it.** You are about to pull a session off its task (park first), or you come back after a day and want to know what is waiting.

**Example.** In `lee-highfield-agent`, Code-Calendar-6 is fixing a calendar parse and you ask it for a system flow diagram instead. Before it pivots:

```
/park "System flow diagram of the whole agent, shareable externally" "later this session, not mid fix"
```

INDEX.md gains the line `- 2026-10-12 · System flow diagram … · next step: later this session, not mid fix · (Code-Calendar-6)`. When the diagram is done:

```
/pending
/unpark 1
```

**What you see.** The band: `Code-Calendar-6  ·  lee-highfield-agent  ·  ▶ … · p:⏳ 1 parked (oldest 0d) · h:2 handoffs`. Press `p` (or ctrl+x then tab to the band, then `p`) to open the parked list in a pane; a digit opens one item with an Unpark button and `b` goes back. `h` opens the handoffs addressed to the Code surface; `n` and `p` page through them. `/pending` prints the same as text.

**Switch off.** `/mods off pulse`. The stale threshold is `/mods set pulseStaleDays 14`.

---

## 5. handover

**What it does.** Shows `ctx 64%` in the status line from 60 percent up, with one toast each at 60, 70, 80 and 90. Sessions named Orchestrator, Lead… or Code… skip auto compaction, so a lead session hands over instead of losing what it knows. `/handover` writes the handover file and copies the kickoff prompt. `/close` checks the session is safe to close.

**When you reach for it.** The status line says `ctx 80%` in a session that holds a lot of context.

**Example.** `Jackfruit/Finance_Agent`, session Lead-Agent-12, at 82 percent with seven engine fixes built and not yet deployed.

```
/handover Lead-Agent-13
```

The model drafts `Claude_Memory/HANDOVER_Lead-Agent-13.md` from this session's own transcript (four sections: work done, learnings and gotchas, pending items, how to start). The kickoff prompt lands on your clipboard between `▼▼▼ START · message for Lead-Agent-13` and `▲▲▲ END` lines, with the folder. Open a new session there, `/rename Lead-Agent-13`, paste. Back in the old session:

```
/close
```

**What you see.** For `/handover`: "Wrote Claude_Memory/HANDOVER_Lead-Agent-13.md. Sections drafted from this session; read it and fix anything wrong before you close." If the file exists already it refuses; add `--force` to replace it. For `/close`: a checklist with ✔ and ✘ lines (git tree clean, INDEX.md and HANDOFFS.md updated today, nothing of this session parked longer than 7 days) ending in "Safe to close." or "Not yet: 2 items above."

When the engine wants to auto compact a lead session you see a toast: "Auto compaction skipped for a lead session: /handover <successor>, or /compact to compact anyway." Manual `/compact` always works.

**Switch off.** `/mods off handover`. Only the compaction guard: `/mods set handoverBlockAutoCompact false`. Which names count as lead: `/mods set handoverLeadPattern ^(Orchestrator|Lead)`.

---

## 6. relay

**What it does.** `/sessions` lists every open Claude Code session on this machine with the names you gave them, this project first. `/relay` sends text, or the last START/END block of my last reply, to one of them. Every message a session's Claude sends another session is headed `[relay from <name> · <project>]`. Messages that arrive show on the band.

**When you reach for it.** You have a message for another session in your clipboard and would otherwise switch windows and paste.

**Example.** In `Numida/Production` the Orchestrator has written a message for its Code session about the knowledge base contradictions, between START and END lines. Instead of copying it:

```
/sessions
/relay Code-2 last
```

Names repeat across projects (there is a Code-2 in M-Kopa too), so a bare name looks in this project first. To reach another project, name it:

```
/relay Finance_Agent/Lead-Agent-12 Diana's response rate ruling is in; read HANDOFFS CD2 before you continue.
```

**What you see.** `/sessions` prints each project with its sessions and how long ago each was active, your own marked `← this session`. `/relay` replies "Relayed to Finance_Agent/Lead-Agent-12." If two sessions share the name it refuses and lists them, never guesses. If delivery fails, the message is copied to your clipboard and the reason is printed. In the receiving session the band shows `i:✉ 1 from Orchestrator (Production)`; press `i` to see the list with a Clear button, and that session's Claude reads the message as a prompt.

**Switch off.** `/mods off relay`.

---

## 7. askmode

**What it does.** When your message is only a question, that turn cannot edit files or run commands that change things (lua push, deploy or promote, `lua env … -k`, `lua version create`, git commit or push, vercel, rm, `sed -i`). Each hold shows a toast. Reply `go` or `/build` to allow changes.

**When you reach for it.** You ask "why does the agent greet twice?" and do not want a fix applied before you have understood the answer.

**Example.** In `Danco-Plastics` you ask the Code session:

```
why did the first real conversations get a second welcome after Danco's line?
```

Claude reads the logs and the preprocessor and explains. If it reaches for Edit, the tool returns "This turn is a question; reply 'go' or /build to allow changes." and you see a toast "askmode held back Edit: this turn is a question." Satisfied, you type:

```
go, fix it in the journey director preprocessor
```

That turn is a request, so edits run.

**What you see.** A message counts as a question when it ends with `?`, starts with why, what, how, when, where, which, who, quick question, explain or a question verb, or says "no code change", "just a question" or "don't change". A message starting with go, fix, add, build, make, change, run, commit, push, or "can you fix…" is never held. Messages the rules cannot place are not held; `/mods set askmodeUseModel true` lets one small model call decide those.

**Switch off.** `/mods off askmode`. For one turn, `/build`.

---

## 8. release

**What it does.** `/promote` reads the version list of this agent and its paired agents, refuses on a dirty git tree, and opens a pane with one Promote button per agent. The press runs the promote (with the deploy confirmation the lua-agent-builder plugin expects), deletes the oldest superseded versions past the cap, and adds a dated line under `## Releases` in `Claude_Memory/TECH.md`.

**When you reach for it.** A version is staged and tested and the session says "promote is yours to run". Built against the real version list JSON; the press itself has only run in tests, so the first live use is with you watching.

**Example.** Jackfruit's top up and lead agents ship together. In `Jackfruit/Finance_Agent/jackfruit-topup-agent/.claude-mods.json`:

```json
{ "pairs": ["../jackfruit-lead-agent"], "versionCap": 95 }
```

Then, in a session in that folder, after the commit:

```
/promote
```

**What you see.** First a plan as text: `jackfruit-topup-agent: v106 → v107 (then prune v12, v13)` and `jackfruit-lead-agent: v22 → v23`, and the pane opens. Nothing has run. Press `Promote jackfruit-topup-agent v106 → v107`. The pane logs each step: promoting, live, pruned, noted in TECH.md, and a toast says "v107 promoted. Run lua version list to confirm." Press the second button for the lead agent, or leave it. If the tree is dirty you get "Refused: 3 uncommitted paths in …. Commit first; the promote should match a commit." and nothing opens.

The cap keeps you under the platform's version limit: Lee's calendar agent had to delete versions by hand at 100; with `versionCap` the oldest superseded ones go on each promote, never the active one.

**Switch off.** `/mods off release`. Without `.claude-mods.json` the agent in the current folder is promoted alone, cap 95.

---

## 9. watch

**What it does.** In a project with a lua agent, one session per project reads one page of the agent's logs every 10 minutes (`lua logs --ci --json --limit 100` since its last mark), counts errors, preprocessor blocks and "fail open" or "GATE BYPASSED" lines, compares errors to the week's median, and runs the `checks` commands from `.claude-mods.json`. A green, amber or red dot leads the band; a toast fires when the level changes. `/logs` prints what it saw since you last asked.

**When you reach for it.** You want to know an agent is misbehaving before the client tells you.

**Example.** Jackfruit already has `scripts/invariant-canary.mjs`, fourteen read only contract checks. In `Jackfruit/Finance_Agent/.claude-mods.json`:

```json
{ "agent": "jackfruit-topup-agent", "checks": { "canary": "node scripts/invariant-canary.mjs --quiet" } }
```

Open any session in that project and work as usual. Fifteen seconds after start the first look runs, then every 10 minutes. When the canary exits non zero:

```
/logs
```

**What you see.** The band starts with `●` in green, yellow or red. A toast: "watch 🔴 Finance_Agent: checks failing: canary. /logs for the lines." `/logs` prints the current light, the counts since you last asked, and the last ten error or block lines with their times. Amber means more errors than usual this week, or preprocessor blocks; red means a bypass line, a failing check, or many errors. Only one session watches each project (the others see the lease and stay quiet), so eleven open sessions do not mean eleven log reads.

**Switch off.** `/mods off watch`. Slower: `/mods set watchIntervalMin 30`.

---

## 10. testguard

**What it does.** While `/testmode on` (or `ALLAN_TESTMODE=1`), a Bash command naming a protected address, a script it runs that names one, or `lua env … -k` on a key ending in CC, ALLOWLIST, RECIPIENT or TO is refused. `/secret set NAME` holds a clipboard value for this session only, injects it where `$NAME` is used, and redacts it from the transcript. A prompt carrying a key shaped string gets a warning.

**When you reach for it.** You are about to test a send path on a live agent and Drew must not get a test email. Or you need to paste a key into a command.

**Example.** Lee's calendar agent emails owners and office staff. In `lee-highfield-agent/.claude-mods.json`:

```json
{ "protected": ["drew@leerealestate.com", "kiri@leerealestate.com"] }
```

Before a requeue test:

```
/testmode on
```

If the session runs `node scripts/requeue.mjs` and that script carries Drew's address, the tool returns "testguard: scripts/requeue.mjs names a protected address (drew@leerealestate.com) while /testmode is on." Setting `CALENDAR_REPLY_CC_EMAIL` with `lua env production -k CALENDAR_REPLY_CC_EMAIL -v …` is refused the same way. After the test:

```
/testmode off
```

For a key: copy it, then

```
/secret set LUA_API_KEY
```

and tell the session to use `$LUA_API_KEY` in its commands. The value never appears in the transcript; tool output that echoes it shows `[LUA_API_KEY redacted]`.

**What you see.** `/testmode on` replies with the protected list. Each hold is a toast plus the refusal text Claude reads. `/secret set` replies "LUA_API_KEY held for this session (40 characters, never shown)." Pasting something like `sk_live_…` into a prompt shows "That message carries something shaped like an API key. Rotate it if it is real; prefer /secret set NAME."

**Switch off.** `/mods off testguard`. `/secret clear` drops the held values.

---

## 11. outbox

**What it does.** When a finished reply holds a message for a contact named in `.claude-mods.json` (a START/END block whose START line names them, or a quoted block introduced as a draft, message or email for them), it is appended to `Claude_Memory/MESSAGES.md` as a draft. `/outbox` opens a pane with Copy, Copy for Slack and Mark sent. Drafts older than a day are mentioned once at session start. Every copy reminds you to re read the live systems first.

**When you reach for it.** A session drafted a question for a client and you will send it tomorrow.

**Example.** Lee's MESSAGES.md already holds entries like `## M21 · DRAFT 2026-10-12 · to Drew · Owner says "no" on weeks LRP already shows booked`; outbox writes the same format. In `lee-highfield-agent/.claude-mods.json`:

```json
{ "contacts": ["Drew", "Kiri", "Tihomir"] }
```

Code-Calendar-6 ends a reply with "Here is the question for Drew:" and a quoted draft. A toast says "outbox kept draft M22 in Claude_Memory/MESSAGES.md (/outbox)." Next morning, in any session in that project, a toast says one draft is older than a day. Then:

```
/outbox
```

**What you see.** A list (`M22 · 2026-10-12 · to Drew · Hi Drew,`) and a pane. Copy puts the body on your clipboard. Copy for Slack turns markdown tables into aligned text and `**bold**` into Slack bold. Both toast "copied. Re-read the live systems behind every claim before you send this." Mark sent turns `DRAFT` into `SENT 2026-10-13` in the file.

**Switch off.** `/mods off outbox`. A project with no `contacts` in `.claude-mods.json` keeps nothing.

---

## Trying them in one sitting

1. `/reload-plugins` in a session, then `/mods`: ten rows.
2. pulse: `/park "test" "none"`, press `p` on the band, press `1`, press Unpark.
3. handover: `/close`, then `/handover Test-1` (delete the file after), then `/mods set handoverThresholds 1,70,80,90` and watch `ctx NN%` appear on the next reply; set it back.
4. relay: `/sessions`, then `/relay <Project>/<name> just reply "got it", nothing else`.
5. askmode: ask "why does the band say 1 parked?" and watch for the toast if Claude reaches for a file; then "go".
6. release: write `.claude-mods.json` in a project with a staged version, `/promote`, press the button while watching `lua version list` in another terminal.
7. watch: add `checks` to the same file, wait 15 seconds, look at the dot, `/logs`.
8. testguard: add `protected`, `/testmode on`, ask the session to `echo <protected address>`, `/testmode off`. Copy a value, `/secret set X`, ask the session to `echo $X`.
9. outbox: add `contacts`, ask the session for a two line quoted draft "for Drew", see the toast, `/outbox`, press Copy for Slack, Mark sent.
10. voice and commit: `/style plain` for one reply; make a commit in any repo and confirm no attribution line.
