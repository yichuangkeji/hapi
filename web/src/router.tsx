import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
    Navigate,
    Outlet,
    createRootRoute,
    createRoute,
    createRouter,
    useLocation,
    useMatchRoute,
    useNavigate,
    useParams,
} from '@tanstack/react-router'
import { App } from '@/App'
import { SessionChat } from '@/components/SessionChat'
import { SessionList, filterVisibleSessions, getSessionDirectory } from '@/components/SessionList'
import { NewSession } from '@/components/NewSession'
import { LoadingState } from '@/components/LoadingState'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useMessages } from '@/hooks/queries/useMessages'
import { useMachines } from '@/hooks/queries/useMachines'
import { useSession } from '@/hooks/queries/useSession'
import { useSessions } from '@/hooks/queries/useSessions'
import { useSlashCommands } from '@/hooks/queries/useSlashCommands'
import { useSkills } from '@/hooks/queries/useSkills'
import { useSendMessage } from '@/hooks/mutations/useSendMessage'
import { queryKeys } from '@/lib/query-keys'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import { clearMessageWindow, fetchLatestMessages, seedMessageWindowFromSession } from '@/lib/message-window-store'
import type { AttachmentMetadata, ResumeRecord, Session, SessionSummary } from '@/types/api'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { basename } from '@/utils/path'
import FilesPage from '@/routes/sessions/files'
import FilePage from '@/routes/sessions/file'
import TerminalPage from '@/routes/sessions/terminal'
import SettingsPage from '@/routes/settings'

function BackIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function SettingsIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    )
}

type ResumeSessionCandidate = {
    kind: 'session'
    id: string
    agent: string
    title: string
    updatedAt?: number
}

type ResumeRecordCandidate = {
    kind: 'record'
    id: string
    agent: ResumeRecord['agent']
    title: string
    updatedAt?: number
}

type ResumeCandidate = ResumeSessionCandidate | ResumeRecordCandidate

function normalizeSessionPath(path?: string | null): string | null {
    const rawPath = path?.trim()
    if (!rawPath) return null
    return rawPath.replace(/[\\/]+$/, '') || rawPath
}

function getResumeToken(session: Session): string | null {
    const metadata = session.metadata
    if (!metadata) return null

    const flavor = metadata.flavor
    if (flavor === 'codex') return metadata.codexSessionId ?? null
    if (flavor === 'gemini') return metadata.geminiSessionId ?? null
    if (flavor === 'opencode') return metadata.opencodeSessionId ?? null
    if (flavor === 'cursor') return metadata.cursorSessionId ?? null
    return metadata.claudeSessionId ?? null
}

function getSessionResumeTitle(session: SessionSummary): string {
    if (session.metadata?.name) return session.metadata.name
    if (session.metadata?.summary?.text) return session.metadata.summary.text
    if (session.metadata?.path) return basename(session.metadata.path) || session.id.slice(0, 8)
    return session.id.slice(0, 8)
}

function getHapiResumeCandidates(currentSession: Session, sessions: SessionSummary[]): ResumeSessionCandidate[] {
    const currentPath = normalizeSessionPath(currentSession.metadata?.path)
    if (!currentPath) return []

    return sessions
        .filter((candidate) => {
            if (candidate.id === currentSession.id) return false
            if (candidate.active) return false
            if (candidate.resumable !== true) return false
            return normalizeSessionPath(candidate.metadata?.path) === currentPath
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((candidate) => ({
            kind: 'session' as const,
            id: candidate.id,
            agent: candidate.metadata?.flavor?.trim() || 'claude',
            title: getSessionResumeTitle(candidate),
            updatedAt: candidate.updatedAt
        }))
}

function shouldShowResumeCandidates(query: string): boolean {
    if (!query.startsWith('/')) return false
    const term = query.slice(1).toLowerCase()
    return term.length > 0 && ('resume'.startsWith(term) || term.startsWith('resume'))
}

function toResumeSuggestion(
    candidate: ResumeCandidate,
    t: (key: string, params?: Record<string, string | number>) => string
): Suggestion {
    const time = candidate.updatedAt ? formatResumeTime(candidate.updatedAt, t) : null
    const description = time
        ? t('session.resume.recordDescription', { agent: candidate.agent, time })
        : candidate.agent

    return {
        key: `resume:${candidate.kind}:${candidate.id}`,
        text: `/resume ${candidate.id}`,
        label: `/resume ${candidate.title}`,
        description,
        source: 'builtin'
    }
}

function formatResumeTime(value: number, t: (key: string, params?: Record<string, string | number>) => string): string {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    const delta = Date.now() - ms
    if (!Number.isFinite(ms) || delta < 0) return new Date(ms).toLocaleString()
    if (delta < 60_000) return t('session.time.justNow')
    const minutes = Math.floor(delta / 60_000)
    if (minutes < 60) return t('session.time.minutesAgo', { n: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('session.time.hoursAgo', { n: hours })
    const days = Math.floor(hours / 24)
    if (days < 7) return t('session.time.daysAgo', { n: days })
    return new Date(ms).toLocaleDateString()
}

function matchesResumeId(candidateId: string, input: string): boolean {
    return candidateId === input || candidateId.startsWith(input)
}

function SessionsPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const pathname = useLocation({ select: location => location.pathname })
    const matchRoute = useMatchRoute()
    const { t } = useTranslation()
    const { sessions, isLoading, error, refetch } = useSessions(api)

    const handleRefresh = useCallback(() => {
        void refetch()
    }, [refetch])

    const sessionMatch = matchRoute({ to: '/sessions/$sessionId', fuzzy: true })
    const selectedSessionId = sessionMatch && sessionMatch.sessionId !== 'new' ? sessionMatch.sessionId : null
    const visibleSessions = useMemo(
        () => filterVisibleSessions(sessions, selectedSessionId),
        [sessions, selectedSessionId]
    )
    const visibleProjectCount = new Set(visibleSessions.map(getSessionDirectory)).size
    const isSessionsIndex = pathname === '/sessions' || pathname === '/sessions/'

    return (
        <div className="flex h-full min-h-0">
            <div
                className={`${isSessionsIndex ? 'flex' : 'hidden lg:flex'} w-full lg:w-[420px] xl:w-[480px] shrink-0 flex-col bg-[var(--app-bg)] lg:border-r lg:border-[var(--app-divider)]`}
            >
                <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                    <div className="mx-auto w-full max-w-content flex items-center justify-between px-3 py-2">
                        <div className="text-xs text-[var(--app-hint)]">
                            {t('sessions.count', { n: visibleSessions.length, m: visibleProjectCount })}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => navigate({ to: '/settings' })}
                                className="p-1.5 rounded-full text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                                title={t('settings.title')}
                            >
                                <SettingsIcon className="h-5 w-5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate({ to: '/sessions/new' })}
                                className="session-list-new-button p-1.5 rounded-full text-[var(--app-link)] transition-colors"
                                title={t('sessions.new')}
                            >
                                <PlusIcon className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto desktop-scrollbar-left">
                    {error ? (
                        <div className="mx-auto w-full max-w-content px-3 py-2">
                            <div className="text-sm text-red-600">{error}</div>
                        </div>
                    ) : null}
                    <SessionList
                        sessions={visibleSessions}
                        selectedSessionId={selectedSessionId}
                        onSelect={(sessionId) => navigate({
                            to: '/sessions/$sessionId',
                            params: { sessionId },
                        })}
                        onNewSession={() => navigate({ to: '/sessions/new' })}
                        onRefresh={handleRefresh}
                        isLoading={isLoading}
                        renderHeader={false}
                        api={api}
                    />
                </div>
            </div>

            <div className={`${isSessionsIndex ? 'hidden lg:flex' : 'flex'} min-w-0 flex-1 flex-col bg-[var(--app-bg)]`}>
                <div className="flex-1 min-h-0">
                    <Outlet />
                </div>
            </div>
        </div>
    )
}

function SessionsIndexPage() {
    return null
}

function SessionPage() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const goBack = useAppGoBack()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { addToast } = useToast()
    const [isResuming, setIsResuming] = useState(false)
    const { sessionId } = useParams({ from: '/sessions/$sessionId' })
    const {
        session,
        refetch: refetchSession,
    } = useSession(api, sessionId)
    const { sessions } = useSessions(api)
    const {
        messages,
        warning: messagesWarning,
        isLoading: messagesLoading,
        isLoadingMore: messagesLoadingMore,
        hasMore: messagesHasMore,
        loadMore: loadMoreMessages,
        refetch: refetchMessages,
        pendingCount,
        messagesVersion,
        flushPending,
        setAtBottom,
    } = useMessages(api, sessionId)
    const handleSessionResolved = useCallback((resolvedSessionId: string) => {
        void (async () => {
            if (api) {
                if (session && resolvedSessionId !== session.id) {
                    seedMessageWindowFromSession(session.id, resolvedSessionId)
                    queryClient.setQueryData(queryKeys.session(resolvedSessionId), {
                        session: { ...session, id: resolvedSessionId, active: true }
                    })
                }
                try {
                    await Promise.all([
                        queryClient.prefetchQuery({
                            queryKey: queryKeys.session(resolvedSessionId),
                            queryFn: () => api.getSession(resolvedSessionId),
                        }),
                        fetchLatestMessages(api, resolvedSessionId),
                    ])
                } catch {
                }
            }
            navigate({
                to: '/sessions/$sessionId',
                params: { sessionId: resolvedSessionId },
                replace: true
            })
        })()
    }, [api, navigate, queryClient, session])
    const {
        sendMessage,
        retryMessage,
        isSending,
    } = useSendMessage(api, sessionId, {
        resolveSessionId: async (currentSessionId) => {
            if (!api || !session || session.active) {
                return currentSessionId
            }
            try {
                return await api.resumeSession(currentSessionId)
            } catch (error) {
                const message = error instanceof Error ? error.message : t('session.resume.failed')
                addToast({
                    title: t('session.resume.failed'),
                    body: message,
                    sessionId: currentSessionId,
                    url: ''
                })
                throw error
            }
        },
        onSessionResolved: handleSessionResolved,
        onBlocked: (reason) => {
            if (reason === 'no-api') {
                addToast({
                    title: t('send.blocked.title'),
                    body: t('send.blocked.noConnection'),
                    sessionId: sessionId ?? '',
                    url: ''
                })
            }
            // 'no-session' and 'pending' don't need toast - either invalid state or expected behavior
        }
    })

    const hapiResumeCandidates = useMemo(
        () => session ? getHapiResumeCandidates(session, sessions) : [],
        [session, sessions]
    )
    const agentType = session?.metadata?.flavor ?? 'claude'

    const resumeSessionById = useCallback(async (targetSessionId: string) => {
        if (!api || isResuming) {
            return
        }

        setIsResuming(true)
        try {
            const resolvedSessionId = await api.resumeSession(targetSessionId)
            // 从当前 active 会话跳到旧 HAPI 会话时，关闭当前 CLI，避免同目录下并行两个 agent。
            if (session?.active && session.id !== targetSessionId && session.id !== resolvedSessionId) {
                await api.archiveSession(session.id).catch(() => {})
            }
            handleSessionResolved(resolvedSessionId)
        } catch (error) {
            const message = error instanceof Error ? error.message : t('session.resume.failed')
            addToast({
                title: t('session.resume.failed'),
                body: message,
                sessionId: targetSessionId,
                url: ''
            })
        } finally {
            setIsResuming(false)
        }
    }, [addToast, api, handleSessionResolved, isResuming, session, t])

    const resumeRecordById = useCallback(async (resumeSessionId: string, agent: string = agentType) => {
        if (!api || !sessionId || isResuming) {
            return
        }

        setIsResuming(true)
        try {
            const resolvedSessionId = await api.resumeRecord(sessionId, { resumeSessionId, agent })
            handleSessionResolved(resolvedSessionId)
        } catch (error) {
            const message = error instanceof Error ? error.message : t('session.resume.failed')
            addToast({
                title: t('session.resume.failed'),
                body: message,
                sessionId,
                url: ''
            })
        } finally {
            setIsResuming(false)
        }
    }, [addToast, agentType, api, handleSessionResolved, isResuming, sessionId, t])

    const fetchResumeRecordCandidates = useCallback(async (): Promise<ResumeRecordCandidate[]> => {
        if (!api || !session || !sessionId || !session.active) {
            return []
        }
        const currentToken = getResumeToken(session)
        const result = await api.getResumeRecords(sessionId, agentType)
        if (!result.success || !result.records) {
            return []
        }

        return result.records
            .filter((record) => record.id !== currentToken)
            .map((record) => ({
                kind: 'record' as const,
                id: record.id,
                agent: record.agent,
                title: record.title?.trim() || record.id.slice(0, 8),
                updatedAt: record.updatedAt
            }))
    }, [agentType, api, session, sessionId])

    const handleResumeCommand = useCallback(async (trimmed: string) => {
        const [, rawTarget] = trimmed.split(/\s+/, 2)
        const target = rawTarget?.trim()

        if (target) {
            const hapiCandidate = hapiResumeCandidates.find((candidate) => matchesResumeId(candidate.id, target))
            if (hapiCandidate) {
                await resumeSessionById(hapiCandidate.id)
                return
            }
            await resumeRecordById(target)
            return
        }

        if (session && !session.active) {
            await resumeSessionById(session.id)
            return
        }

        const recordCandidates = await fetchResumeRecordCandidates().catch(() => [])
        const latestRecord = recordCandidates[0]
        if (latestRecord) {
            await resumeRecordById(latestRecord.id, latestRecord.agent)
            return
        }

        const latestHapiSession = hapiResumeCandidates[0]
        if (latestHapiSession) {
            await resumeSessionById(latestHapiSession.id)
            return
        }

        addToast({
            title: t('session.resume.failed'),
            body: t('session.resume.noneInDirectory'),
            sessionId: sessionId ?? '',
            url: ''
        })
    }, [
        addToast,
        fetchResumeRecordCandidates,
        hapiResumeCandidates,
        resumeRecordById,
        resumeSessionById,
        session,
        sessionId,
        t
    ])

    const handleSend = useCallback((text: string, attachments?: AttachmentMetadata[]) => {
        const trimmed = text.trim()
        const hasAttachments = Boolean(attachments && attachments.length > 0)
        const normalizedCommand = trimmed.toLowerCase()
        if (!hasAttachments && (normalizedCommand === '/resume' || normalizedCommand.startsWith('/resume '))) {
            void handleResumeCommand(trimmed)
            return
        }

        const supportsNativeConversationCommand = agentType === 'codex' || agentType === 'claude'
        if (supportsNativeConversationCommand && trimmed === '/clear' && (!attachments || attachments.length === 0)) {
            void (async () => {
                if (!api || !sessionId) {
                    return
                }
                try {
                    await api.clearSessionConversation(sessionId)
                    clearMessageWindow(sessionId)
                    void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'Clear failed'
                    addToast({
                        title: 'Clear failed',
                        body: message,
                        sessionId,
                        url: ''
                    })
                }
            })()
            return
        }

        if (supportsNativeConversationCommand && (trimmed === '/compact' || trimmed === '/compat') && (!attachments || attachments.length === 0)) {
            void (async () => {
                if (!api || !sessionId) {
                    return
                }
                try {
                    await api.compactSessionConversation(sessionId)
                    void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'Compact failed'
                    addToast({
                        title: 'Compact failed',
                        body: message,
                        sessionId,
                        url: ''
                    })
                }
            })()
            return
        }

        sendMessage(text, attachments)
    }, [addToast, agentType, api, handleResumeCommand, queryClient, sendMessage, sessionId])
    const {
        getSuggestions: getSlashSuggestions,
    } = useSlashCommands(api, sessionId, agentType)
    const {
        getSuggestions: getSkillSuggestions,
    } = useSkills(api, sessionId)

    const getAutocompleteSuggestions = useCallback(async (query: string) => {
        if (query.startsWith('$')) {
            return await getSkillSuggestions(query)
        }
        if (shouldShowResumeCandidates(query)) {
            const [slashSuggestions, recordCandidates] = await Promise.all([
                getSlashSuggestions(query),
                fetchResumeRecordCandidates().catch(() => [])
            ])
            const candidates: ResumeCandidate[] = [...recordCandidates, ...hapiResumeCandidates]
            const resumeSuggestions = candidates.map((candidate) => toResumeSuggestion(candidate, t))
            return resumeSuggestions.length > 0 ? resumeSuggestions : slashSuggestions
        }
        return await getSlashSuggestions(query)
    }, [fetchResumeRecordCandidates, getSkillSuggestions, getSlashSuggestions, hapiResumeCandidates, t])

    const refreshSelectedSession = useCallback(() => {
        void refetchSession()
        void refetchMessages()
    }, [refetchMessages, refetchSession])

    if (!session) {
        return (
            <div className="flex-1 flex items-center justify-center p-4">
                <LoadingState label="Loading session…" className="text-sm" />
            </div>
        )
    }

    return (
        <SessionChat
            api={api}
            session={session}
            messages={messages}
            messagesWarning={messagesWarning}
            hasMoreMessages={messagesHasMore}
            isLoadingMessages={messagesLoading}
            isLoadingMoreMessages={messagesLoadingMore}
            isSending={isSending}
            pendingCount={pendingCount}
            messagesVersion={messagesVersion}
            onBack={goBack}
            onRefresh={refreshSelectedSession}
            onLoadMore={loadMoreMessages}
            onSend={handleSend}
            onFlushPending={flushPending}
            onAtBottomChange={setAtBottom}
            onRetryMessage={retryMessage}
            autocompleteSuggestions={getAutocompleteSuggestions}
        />
    )
}

function SessionDetailRoute() {
    const pathname = useLocation({ select: location => location.pathname })
    const { sessionId } = useParams({ from: '/sessions/$sessionId' })
    const basePath = `/sessions/${sessionId}`
    const isChat = pathname === basePath || pathname === `${basePath}/`

    return isChat ? <SessionPage /> : <Outlet />
}

function NewSessionPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    const queryClient = useQueryClient()
    const { machines, isLoading: machinesLoading, error: machinesError } = useMachines(api, true)
    const { t } = useTranslation()

    const handleCancel = useCallback(() => {
        navigate({ to: '/sessions' })
    }, [navigate])

    const handleSuccess = useCallback((sessionId: string) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        // Replace current page with /sessions to clear spawn flow from history
        navigate({ to: '/sessions', replace: true })
        // Then navigate to new session
        requestAnimationFrame(() => {
            navigate({
                to: '/sessions/$sessionId',
                params: { sessionId },
            })
        })
    }, [navigate, queryClient])

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-bg)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                {!isTelegramApp() && (
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                )}
                <div className="flex-1 font-semibold">{t('newSession.title')}</div>
            </div>

            {machinesError ? (
                <div className="p-3 text-sm text-red-600">
                    {machinesError}
                </div>
            ) : null}

            <NewSession
                api={api}
                machines={machines}
                isLoading={machinesLoading}
                onCancel={handleCancel}
                onSuccess={handleSuccess}
            />
        </div>
    )
}

const rootRoute = createRootRoute({
    component: App,
})

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <Navigate to="/sessions" replace />,
})

const sessionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sessions',
    component: SessionsPage,
})

const sessionsIndexRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: '/',
    component: SessionsIndexPage,
})

const sessionDetailRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: '$sessionId',
    component: SessionDetailRoute,
})

const sessionFilesRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'files',
    validateSearch: (search: Record<string, unknown>): { tab?: 'changes' | 'directories' } => {
        const tabValue = typeof search.tab === 'string' ? search.tab : undefined
        const tab = tabValue === 'directories'
            ? 'directories'
            : tabValue === 'changes'
                ? 'changes'
                : undefined

        return tab ? { tab } : {}
    },
    component: FilesPage,
})

const sessionTerminalRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'terminal',
    component: TerminalPage,
})

type SessionFileSearch = {
    path: string
    staged?: boolean
    tab?: 'changes' | 'directories'
}

const sessionFileRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'file',
    validateSearch: (search: Record<string, unknown>): SessionFileSearch => {
        const path = typeof search.path === 'string' ? search.path : ''
        const staged = search.staged === true || search.staged === 'true'
            ? true
            : search.staged === false || search.staged === 'false'
                ? false
                : undefined

        const tabValue = typeof search.tab === 'string' ? search.tab : undefined
        const tab = tabValue === 'directories'
            ? 'directories'
            : tabValue === 'changes'
                ? 'changes'
                : undefined

        const result: SessionFileSearch = { path }
        if (staged !== undefined) {
            result.staged = staged
        }
        if (tab !== undefined) {
            result.tab = tab
        }
        return result
    },
    component: FilePage,
})

const newSessionRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: 'new',
    component: NewSessionPage,
})

const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: SettingsPage,
})

export const routeTree = rootRoute.addChildren([
    indexRoute,
    sessionsRoute.addChildren([
        sessionsIndexRoute,
        newSessionRoute,
        sessionDetailRoute.addChildren([
            sessionTerminalRoute,
            sessionFilesRoute,
            sessionFileRoute,
        ]),
    ]),
    settingsRoute,
])

type RouterHistory = Parameters<typeof createRouter>[0]['history']

export function createAppRouter(history?: RouterHistory) {
    return createRouter({
        routeTree,
        history,
        scrollRestoration: true,
    })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
    interface Register {
        router: AppRouter
    }
}
