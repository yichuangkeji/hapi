import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol/types'
import { Store } from '../store'
import type { EventPublisher } from './eventPublisher'
import { SessionCache } from './sessionCache'

function createPublisher(events: SyncEvent[]): EventPublisher {
    return {
        emit: (event: SyncEvent) => {
            events.push(event)
        }
    } as unknown as EventPublisher
}

describe('SessionCache.resetSessionConversation', () => {
    it('clears stored messages and emits session-cleared', async () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const session = cache.getOrCreateSession(
            'reset-session-test',
            {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'codex',
                codexSessionId: 'thread_123',
                summary: {
                    text: 'old summary',
                    updatedAt: 123
                }
            },
            {
                controlledByUser: false,
                requests: {
                    pending: {
                        tool: 'shell',
                        arguments: {},
                        createdAt: 1
                    }
                }
            },
            'default'
        )

        store.messages.addMessage(session.id, {
            role: 'user',
            content: {
                type: 'text',
                text: 'old message'
            }
        })
        store.sessions.setSessionTodos(session.id, [], Date.now(), 'default')
        store.sessions.setSessionTeamState(session.id, {
            teamName: 'team',
            members: [],
            tasks: [],
            messages: []
        }, Date.now(), 'default')

        events.length = 0
        const refreshed = await cache.resetSessionConversation(session.id, {
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'codex'
            },
            agentState: {
                controlledByUser: false
            }
        })

        expect(store.messages.getMessages(session.id, 50)).toHaveLength(0)
        expect(refreshed.metadata?.codexSessionId).toBeUndefined()
        expect(refreshed.metadata?.summary).toBeUndefined()
        expect(refreshed.agentState?.requests).toBeUndefined()
        expect(refreshed.todos).toBeUndefined()
        expect(refreshed.teamState).toBeUndefined()
        expect(events.some((event) => event.type === 'session-cleared' && event.sessionId === session.id)).toBe(true)
    })
})
