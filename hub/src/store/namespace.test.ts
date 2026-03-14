import { describe, expect, it } from 'bun:test'
import { Store } from './index'

describe('Store namespace filtering', () => {
    it('filters sessions by namespace', () => {
        const store = new Store(':memory:')
        const sessionAlpha = store.sessions.getOrCreateSession('tag', { path: '/alpha' }, null, 'alpha')
        const sessionBeta = store.sessions.getOrCreateSession('tag', { path: '/beta' }, null, 'beta')

        const sessionsAlpha = store.sessions.getSessionsByNamespace('alpha')
        const ids = sessionsAlpha.map((session) => session.id)

        expect(ids).toContain(sessionAlpha.id)
        expect(ids).not.toContain(sessionBeta.id)
    })

    it('filters machines by namespace and blocks mismatches', () => {
        const store = new Store(':memory:')
        const machineAlpha = store.machines.getOrCreateMachine('machine-1', { host: 'alpha' }, null, 'alpha')
        store.machines.getOrCreateMachine('machine-2', { host: 'beta' }, null, 'beta')

        const machinesAlpha = store.machines.getMachinesByNamespace('alpha')
        const ids = machinesAlpha.map((machine) => machine.id)

        expect(ids).toContain(machineAlpha.id)
        expect(ids).not.toContain('machine-2')
        expect(() => store.machines.getOrCreateMachine('machine-1', { host: 'beta' }, null, 'beta')).toThrow()
    })

    it('reuses legacy random-tag session when workspace tag matches same namespace/path/flavor', () => {
        const store = new Store(':memory:')
        const metadata = { path: '/workspace/a', flavor: 'claude' }
        const legacy = store.sessions.getOrCreateSession('legacy-random-tag', metadata, null, 'alpha')

        const reused = store.sessions.getOrCreateSession('workspace:v1:claude:testhash', metadata, null, 'alpha')

        expect(reused.id).toBe(legacy.id)
        expect(reused.tag).toBe('workspace:v1:claude:testhash')
    })

    it('does not reuse sessions from other namespace', () => {
        const store = new Store(':memory:')
        const metadata = { path: '/workspace/a', flavor: 'claude' }
        store.sessions.getOrCreateSession('legacy-random-tag', metadata, null, 'alpha')

        const created = store.sessions.getOrCreateSession('workspace:v1:claude:testhash', metadata, null, 'beta')

        expect(created.namespace).toBe('beta')
        expect(created.tag).toBe('workspace:v1:claude:testhash')
    })
})
