import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

import { ApiClient } from '@/api/api'
import type { ApiSessionClient } from '@/api/apiSession'
import type { AgentState, MachineMetadata, Metadata, Session } from '@/api/types'
import { notifyRunnerSessionStarted } from '@/runner/controlClient'
import { readSettings } from '@/persistence'
import { configuration } from '@/configuration'
import { logger } from '@/ui/logger'
import { runtimePath } from '@/projectPath'
import { readWorktreeEnv } from '@/utils/worktreeEnv'
import packageJson from '../../package.json'

export type SessionStartedBy = 'runner' | 'terminal'

export type SessionBootstrapOptions = {
    flavor: string
    startedBy?: SessionStartedBy
    workingDirectory?: string
    tag?: string
    agentState?: AgentState | null
    resumeSessionId?: string | null
}

export type SessionBootstrapResult = {
    api: ApiClient
    session: ApiSessionClient
    sessionInfo: Session
    metadata: Metadata
    machineId: string
    startedBy: SessionStartedBy
    workingDirectory: string
}

function normalizeWorkspacePath(workingDirectory: string): string {
    const resolvedPath = resolve(workingDirectory)
    let canonicalPath = resolvedPath
    try {
        canonicalPath = realpathSync.native(resolvedPath)
    } catch {
        // Keep resolved path when realpath fails.
    }

    const slashNormalized = canonicalPath.replace(/\\/g, '/')
    const withoutTrailingSlash = slashNormalized.length > 1
        ? slashNormalized.replace(/\/+$/, '')
        : slashNormalized

    if (process.platform === 'win32') {
        return withoutTrailingSlash.toLowerCase()
    }
    return withoutTrailingSlash
}

export function createWorkspaceSessionTag(flavor: string, workingDirectory: string): string {
    const normalizedPath = normalizeWorkspacePath(workingDirectory)
    const digest = createHash('sha256')
        .update(JSON.stringify({ flavor, path: normalizedPath }))
        .digest('hex')
    return `workspace:v1:${flavor}:${digest}`
}

export function buildMachineMetadata(): MachineMetadata {
    return {
        host: process.env.HAPI_HOSTNAME || os.hostname(),
        platform: os.platform(),
        happyCliVersion: packageJson.version,
        homeDir: os.homedir(),
        happyHomeDir: configuration.happyHomeDir,
        happyLibDir: runtimePath()
    }
}

export function buildSessionMetadata(options: {
    flavor: string
    startedBy: SessionStartedBy
    workingDirectory: string
    machineId: string
    now?: number
}): Metadata {
    const happyLibDir = runtimePath()
    const worktreeInfo = readWorktreeEnv()
    const now = options.now ?? Date.now()

    return {
        path: options.workingDirectory,
        host: os.hostname(),
        version: packageJson.version,
        os: os.platform(),
        machineId: options.machineId,
        homeDir: os.homedir(),
        happyHomeDir: configuration.happyHomeDir,
        happyLibDir,
        happyToolsDir: resolve(happyLibDir, 'tools', 'unpacked'),
        startedFromRunner: options.startedBy === 'runner',
        hostPid: process.pid,
        startedBy: options.startedBy,
        lifecycleState: 'running',
        lifecycleStateSince: now,
        flavor: options.flavor,
        worktree: worktreeInfo ?? undefined
    }
}

function getConversationTokenField(flavor: string): keyof Metadata | null {
    switch (flavor) {
        case 'claude':
            return 'claudeSessionId'
        case 'codex':
            return 'codexSessionId'
        case 'gemini':
            return 'geminiSessionId'
        case 'opencode':
            return 'opencodeSessionId'
        case 'cursor':
            return 'cursorSessionId'
        default:
            return null
    }
}

export function shouldResetStaleSessionConversation(args: {
    flavor: string
    session: Session
    resumeSessionId?: string | null
}): boolean {
    if (args.resumeSessionId) {
        return false
    }
    if (args.session.active) {
        return false
    }

    const tokenField = getConversationTokenField(args.flavor)
    if (!tokenField) {
        return false
    }

    const metadata = args.session.metadata
    return Boolean(metadata && typeof metadata[tokenField] === 'string' && metadata[tokenField])
}

async function getMachineIdOrExit(): Promise<string> {
    const settings = await readSettings()
    const machineId = settings?.machineId
    if (!machineId) {
        console.error(`[START] No machine ID found in settings, which is unexpected since authAndSetupMachineIfNeeded should have created it. Please report this issue on ${packageJson.bugs}`)
        process.exit(1)
    }
    logger.debug(`Using machineId: ${machineId}`)
    return machineId
}

async function reportSessionStarted(sessionId: string, metadata: Metadata): Promise<void> {
    try {
        logger.debug(`[START] Reporting session ${sessionId} to runner`)
        const result = await notifyRunnerSessionStarted(sessionId, metadata)
        if (result?.error) {
            logger.debug(`[START] Failed to report to runner (may not be running):`, result.error)
        } else {
            logger.debug(`[START] Reported session ${sessionId} to runner`)
        }
    } catch (error) {
        logger.debug('[START] Failed to report to runner (may not be running):', error)
    }
}

export async function bootstrapSession(options: SessionBootstrapOptions): Promise<SessionBootstrapResult> {
    const workingDirectory = options.workingDirectory ?? process.cwd()
    const startedBy = options.startedBy ?? 'terminal'
    const sessionTag = options.tag
        ?? (startedBy === 'terminal'
            ? createWorkspaceSessionTag(options.flavor, workingDirectory)
            : randomUUID())
    const agentState = options.agentState === undefined ? {} : options.agentState

    const api = await ApiClient.create()

    const machineId = await getMachineIdOrExit()
    await api.getOrCreateMachine({
        machineId,
        metadata: buildMachineMetadata()
    })

    const metadata = buildSessionMetadata({
        flavor: options.flavor,
        startedBy,
        workingDirectory,
        machineId
    })

    let sessionInfo = await api.getOrCreateSession({
        tag: sessionTag,
        metadata,
        state: agentState
    })

    if (shouldResetStaleSessionConversation({
        flavor: options.flavor,
        session: sessionInfo,
        resumeSessionId: options.resumeSessionId
    })) {
        sessionInfo = await api.resetSessionConversation({
            sessionId: sessionInfo.id,
            metadata: {
                ...metadata,
                name: typeof sessionInfo.metadata?.name === 'string' ? sessionInfo.metadata.name : undefined
            },
            state: agentState
        })
    }

    const session = api.sessionSyncClient(sessionInfo)

    await reportSessionStarted(sessionInfo.id, metadata)

    return {
        api,
        session,
        sessionInfo,
        metadata,
        machineId,
        startedBy,
        workingDirectory
    }
}
