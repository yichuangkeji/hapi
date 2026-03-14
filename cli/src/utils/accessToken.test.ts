import { describe, expect, it } from 'vitest'
import {
    DEFAULT_NAMESPACE,
    getMachineRegistrationScope,
    getRunnerConnectionIdentity,
    normalizeApiUrl,
    parseAccessToken,
    resolveAccessTokenNamespace
} from './accessToken'

describe('accessToken utils', () => {
    it('defaults namespace when suffix is missing', () => {
        expect(parseAccessToken('token')).toEqual({ baseToken: 'token', namespace: DEFAULT_NAMESPACE })
        expect(resolveAccessTokenNamespace('token')).toBe(DEFAULT_NAMESPACE)
    })

    it('parses namespace suffix', () => {
        expect(parseAccessToken('token:alice')).toEqual({ baseToken: 'token', namespace: 'alice' })
        expect(resolveAccessTokenNamespace('token:alice')).toBe('alice')
    })

    it('rejects empty or whitespace-padded namespace', () => {
        expect(parseAccessToken('token:')).toBeNull()
        expect(parseAccessToken('token: alice')).toBeNull()
        expect(parseAccessToken(' token ')).toEqual({ baseToken: 'token', namespace: DEFAULT_NAMESPACE })
    })

    it('normalizes api urls before building identities', () => {
        expect(normalizeApiUrl('http://localhost:3006///')).toBe('http://localhost:3006')

        const first = getRunnerConnectionIdentity('http://localhost:3006', 'token:alice')
        const second = getRunnerConnectionIdentity('http://localhost:3006/', 'token:alice')
        expect(first).toBe(second)
    })

    it('scopes machine registration by namespace and hub', () => {
        const base = getMachineRegistrationScope('http://localhost:3006', 'token')
        const same = getMachineRegistrationScope('http://localhost:3006/', 'token')
        const differentNamespace = getMachineRegistrationScope('http://localhost:3006', 'token:alice')
        const differentHub = getMachineRegistrationScope('http://localhost:3007', 'token')

        expect(base).toBe(same)
        expect(base).not.toBe(differentNamespace)
        expect(base).not.toBe(differentHub)
    })
})
