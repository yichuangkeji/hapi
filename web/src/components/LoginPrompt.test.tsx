import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { LoginPrompt } from './LoginPrompt'
import { ApiClient } from '@/api/client'

function renderWithProviders(ui: React.ReactElement) {
    return render(
        <I18nProvider>
            {ui}
        </I18nProvider>
    )
}

describe('LoginPrompt', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        const localStorageMock = {
            getItem: vi.fn(() => 'en'),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        }
        Object.defineProperty(window, 'localStorage', { value: localStorageMock })
    })

    afterEach(() => {
        cleanup()
    })

    it('appends namespace to access token when namespace input is provided', async () => {
        const authenticateSpy = vi.spyOn(ApiClient.prototype, 'authenticate').mockResolvedValue({
            token: 'jwt-token',
            user: { id: 1 }
        })
        const onLogin = vi.fn()

        renderWithProviders(
            <LoginPrompt
                baseUrl="https://app.example.com"
                serverUrl="https://hub.example.com"
                setServerUrl={vi.fn((value: string) => ({ ok: true as const, value }))}
                clearServerUrl={vi.fn()}
                onLogin={onLogin}
            />
        )

        fireEvent.change(screen.getByPlaceholderText('Access token'), { target: { value: 'base-token' } })
        fireEvent.change(screen.getByPlaceholderText('Namespace (optional)'), { target: { value: ' alice ' } })
        fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

        await waitFor(() => {
            expect(authenticateSpy).toHaveBeenCalledWith({ accessToken: 'base-token:alice' })
            expect(onLogin).toHaveBeenCalledWith('base-token:alice')
        })
    })

    it('does not clear first hub URL edit when hub URL required', async () => {
        renderWithProviders(
            <LoginPrompt
                baseUrl="https://app.example.com"
                serverUrl={null}
                setServerUrl={vi.fn((value: string) => ({ ok: true as const, value }))}
                clearServerUrl={vi.fn()}
                requireServerUrl={true}
                onLogin={vi.fn()}
            />
        )

        fireEvent.change(screen.getByPlaceholderText('Access token'), { target: { value: 'token' } })
        fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

        const hubInput = await screen.findByPlaceholderText('https://hapi.example.com')
        expect(screen.getByText('Hub URL required. Please set it before signing in.')).toBeInTheDocument()

        fireEvent.change(hubInput, { target: { value: 'https://hub.example.com' } })

        expect(hubInput).toHaveValue('https://hub.example.com')
        expect(screen.queryByText('Hub URL required. Please set it before signing in.')).not.toBeInTheDocument()
    })
})
