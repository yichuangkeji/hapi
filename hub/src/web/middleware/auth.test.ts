import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { createAuthMiddleware } from './auth'

const jwtSecret = new TextEncoder().encode('test-jwt-secret-1234567890')

async function createToken(namespace: string): Promise<string> {
    return await new SignJWT({ uid: 1, ns: namespace })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(jwtSecret)
}

describe('createAuthMiddleware', () => {
    it('adds Vary: Authorization header on authenticated API responses', async () => {
        const app = new Hono()
        app.use('*', createAuthMiddleware(jwtSecret))
        app.get('/api/machines', (c) => c.json({ ok: true }))

        const token = await createToken('alpha')
        const response = await app.request('http://localhost/api/machines', {
            headers: {
                Authorization: `Bearer ${token}`
            }
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('Vary')).toBe('Authorization')
    })
})
