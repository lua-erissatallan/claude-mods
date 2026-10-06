import type { EngineInterface, On } from 'claude-code'

import { isOn, modeOf, textOf, type Options } from '../lib/switch'

const PUSH = /(^|[;&|]\s*|\s)git\b(?:\s+-C\s+\S+)?[^;&|\n]*?\bpush\b/
const PR_TEXT = /\bgh\s+pr\s+(create|comment|review|edit)\b/
const INTERNAL = /\b(?:D|H|CC|CR|O)\d{1,3}\b|Claude_Memory|HANDOFFS(?:\.md)?\b/
const OUTWARD_PATH = /\/(docs|Business_Documents)\//

/** The folder a git command runs in: `git -C <dir>`, a leading `cd <dir> &&`, else the session cwd. */
async function dirOf($: EngineInterface, command: string): Promise<string> {
  const c = command.match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/)
  if (c?.[1] !== undefined) return c[1].replace(/^["']|["']$/g, '')
  const cd = command.match(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*&&/)
  if (cd?.[1] !== undefined) return cd[1].replace(/^["']|["']$/g, '').replace(/^~/, (await $.env.get('HOME')) ?? '~')
  return $.session.cwd()
}

function remoteOf(command: string): string {
  const after = command.slice(command.search(/\bpush\b/) + 4).trim().split(/\s+/)
  return after.find(t => t !== '' && !t.startsWith('-')) ?? 'origin'
}

async function git($: EngineInterface, dir: string, args: string[]): Promise<string> {
  const r = await $.process.run(['git', '-C', dir, ...args])
  return r.exitCode === 0 ? r.stdout.trim() : ''
}

export function commit(on: On, options: Options): void {
  on('attribution.text', ($, e, next) => {
    if (!isOn(options, 'commit')) return next(e)
    return e.kind === 'commit' || e.kind === 'pr' ? { text: '' } : next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isOn(options, 'commit')) return next(e)
    const command = String(e.command ?? '')

    const identity = modeOf(options, 'commitIdentity', 'block')
    if (identity !== 'off' && PUSH.test(command)) {
      const dir = await dirOf($, command)
      const url = await git($, dir, ['remote', 'get-url', remoteOf(command)])
      const email = await git($, dir, ['config', 'user.email'])
      const wantEmail = textOf(options, 'commitEmail', 'allan@luaimplementation.ai')
      const problems = [
        url !== '' && !url.includes('github.com-lua') ? `remote is ${url} (not github.com-lua)` : '',
        email !== '' && email !== wantEmail ? `user.email is ${email} (not ${wantEmail})` : '',
      ].filter(Boolean)
      if (problems.length > 0) {
        const why = `allan/commit: this push would leave under the wrong identity: ${problems.join('; ')}.`
        if (identity === 'block') {
          return { deny: `${why} Fix the remote or user.email in ${dir}, or allow it with /mods set commitIdentity warn.` }
        }
        $.ui.toast(why)
      }
    }

    const ids = modeOf(options, 'commitInternalIds', 'warn')
    if (ids !== 'off' && PR_TEXT.test(command) && INTERNAL.test(command)) {
      const why = `allan/commit: this PR text carries an internal memory reference (${command.match(INTERNAL)?.[0] ?? ''}). Clients and reviewers should not see those.`
      if (ids === 'block') return { deny: `${why} Rewrite it, or /mods set commitInternalIds warn.` }
      $.ui.toast(why)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (!isOn(options, 'commit')) return next(e)
    const ids = modeOf(options, 'commitInternalIds', 'warn')
    const path = String(e.file_path ?? '')
    const text = String(e.content ?? '')
    if (ids !== 'off' && OUTWARD_PATH.test(path) && INTERNAL.test(text)) {
      const why = `allan/commit: ${path} is client facing and carries an internal reference (${text.match(INTERNAL)?.[0] ?? ''}).`
      if (ids === 'block') return { deny: `${why} Rewrite it, or /mods set commitInternalIds warn.` }
      $.ui.toast(why)
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}
