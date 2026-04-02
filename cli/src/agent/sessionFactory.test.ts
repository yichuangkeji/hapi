import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import type { Session } from '@/api/types'

const apiClientCreate = vi.fn()
const readSettings = vi.fn()
const notifyRunnerSessionStarted = vi.fn()

vi.mock('@/api/api', () => ({
    ApiClient: {
        create: apiClientCreate
    }
}))

vi.mock('@/persistence', () => ({
    readSettings
}))

vi.mock('@/runner/controlClient', () => ({
    notifyRunnerSessionStarted
}))

vi.mock('@/configuration', () => ({
    configuration: {
        apiUrl: 'http://127.0.0.1:3006',
        cliApiToken: 'token',
        happyHomeDir: '/tmp/.hapi'
    }
}))

vi.mock('@/projectPath', () => ({
    runtimePath: () => '/tmp/hapi-runtime'
}))

vi.mock('@/utils/worktreeEnv', () => ({
    readWorktreeEnv: () => null
}))

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn()
    }
}))

function createDeferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

async function loadSessionFactory() {
    return await import('./sessionFactory')
}

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

describe('createWorkspaceSessionTag', () => {
    it('returns a stable tag for the same workspace path', async () => {
        const { createWorkspaceSessionTag } = await loadSessionFactory()
        const cwd = process.cwd()
        const withTrailingSlash = `${cwd}/`

        const first = createWorkspaceSessionTag('claude', cwd)
        const second = createWorkspaceSessionTag('claude', withTrailingSlash)

        expect(first).toBe(second)
    })

    it('changes when flavor changes', async () => {
        const { createWorkspaceSessionTag } = await loadSessionFactory()
        const cwd = process.cwd()

        const claudeTag = createWorkspaceSessionTag('claude', cwd)
        const codexTag = createWorkspaceSessionTag('codex', cwd)

        expect(claudeTag).not.toBe(codexTag)
    })

    it('changes when workspace path changes', async () => {
        const { createWorkspaceSessionTag } = await loadSessionFactory()
        const cwd = process.cwd()
        const otherPath = join(cwd, '__workspace_b')

        const first = createWorkspaceSessionTag('claude', cwd)
        const second = createWorkspaceSessionTag('claude', otherPath)

        expect(first).not.toBe(second)
    })
})

describe('shouldResetStaleSessionConversation', () => {
    it('resets a reused inactive codex session with an existing conversation token', async () => {
        const { shouldResetStaleSessionConversation } = await loadSessionFactory()
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

    it('does not reset when explicitly resuming', async () => {
        const { shouldResetStaleSessionConversation } = await loadSessionFactory()
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

    it('does not reset active sessions', async () => {
        const { shouldResetStaleSessionConversation } = await loadSessionFactory()
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

describe('bootstrapSession', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        readSettings.mockResolvedValue({ machineId: 'machine-1' })
    })

    it('does not wait for runner session-started notification before returning', async () => {
        const deferred = createDeferred<{ error?: string }>()
        notifyRunnerSessionStarted.mockImplementation(() => deferred.promise)

        const fakeSessionClient = { kind: 'session-client' }
        const fakeSessionInfo = {
            id: 'session-1',
            active: false,
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'codex'
            },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1
        }

        apiClientCreate.mockResolvedValue({
            getOrCreateMachine: vi.fn().mockResolvedValue({ id: 'machine-1' }),
            getOrCreateSession: vi.fn().mockResolvedValue(fakeSessionInfo),
            resetSessionConversation: vi.fn(),
            sessionSyncClient: vi.fn(() => fakeSessionClient)
        })

        const { bootstrapSession } = await loadSessionFactory()
        const bootstrapPromise = bootstrapSession({
            flavor: 'codex',
            workingDirectory: '/tmp/project'
        })

        const result = await Promise.race([
            bootstrapPromise.then((value) => ({ type: 'resolved' as const, value })),
            new Promise<{ type: 'timeout' }>((resolve) => {
                setTimeout(() => resolve({ type: 'timeout' }), 20)
            })
        ])

        expect(result.type).toBe('resolved')
        if (result.type !== 'resolved') {
            deferred.resolve({})
            throw new Error('bootstrapSession waited for runner notification')
        }

        expect(result.value.session).toBe(fakeSessionClient)
        expect(notifyRunnerSessionStarted).toHaveBeenCalledWith(
            'session-1',
            expect.objectContaining({
                path: '/tmp/project',
                flavor: 'codex',
                machineId: 'machine-1'
            })
        )

        deferred.resolve({})
        await Promise.resolve()
    })
})
