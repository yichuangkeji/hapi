import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import type { Session } from '@/api/types'
import { createWorkspaceSessionTag, shouldResetStaleSessionConversation } from './sessionFactory'

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

function createSession(overrides?: Partial<Session>): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: false,
        activeAt: 1,
        metadata: {
            path: '/tmp/project',
            host: 'localhost'
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        ...overrides
    }
}

describe('shouldResetStaleSessionConversation', () => {
    it('resets a reused inactive codex session with an existing conversation token', () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                codexSessionId: 'thread_123'
            }
        })

        expect(shouldResetStaleSessionConversation({
            flavor: 'codex',
            session
        })).toBe(true)
    })

    it('does not reset when explicitly resuming', () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                codexSessionId: 'thread_123'
            }
        })

        expect(shouldResetStaleSessionConversation({
            flavor: 'codex',
            session,
            resumeSessionId: 'thread_123'
        })).toBe(false)
    })

    it('does not reset active sessions', () => {
        const session = createSession({
            active: true,
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                codexSessionId: 'thread_123'
            }
        })

        expect(shouldResetStaleSessionConversation({
            flavor: 'codex',
            session
        })).toBe(false)
    })
})
