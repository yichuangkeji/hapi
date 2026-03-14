import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { createWorkspaceSessionTag } from './sessionFactory'

describe('createWorkspaceSessionTag', () => {
    it('returns a stable tag for the same workspace path', () => {
        const cwd = process.cwd()
        const withTrailingSlash = `${cwd}/`

        const first = createWorkspaceSessionTag('claude', cwd)
        const second = createWorkspaceSessionTag('claude', withTrailingSlash)

        expect(first).toBe(second)
    })

    it('changes when flavor changes', () => {
        const cwd = process.cwd()

        const claudeTag = createWorkspaceSessionTag('claude', cwd)
        const codexTag = createWorkspaceSessionTag('codex', cwd)

        expect(claudeTag).not.toBe(codexTag)
    })

    it('changes when workspace path changes', () => {
        const cwd = process.cwd()
        const otherPath = join(cwd, '__workspace_b')

        const first = createWorkspaceSessionTag('claude', cwd)
        const second = createWorkspaceSessionTag('claude', otherPath)

        expect(first).not.toBe(second)
    })
})
