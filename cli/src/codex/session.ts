import { ApiClient, ApiSessionClient } from '@/lib';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { AgentSessionBase } from '@/agent/sessionBase';
import type { EnhancedMode, PermissionMode } from './loop';
import type { CodexCliOverrides } from './utils/codexCliOverrides';
import type { LocalLaunchExitReason } from '@/agent/localLaunchPolicy';

type LocalLaunchFailure = {
    message: string;
    exitReason: LocalLaunchExitReason;
};

export class CodexSession extends AgentSessionBase<EnhancedMode> {
    readonly codexArgs?: string[];
    readonly codexCliOverrides?: CodexCliOverrides;
    readonly startedBy: 'runner' | 'terminal';
    readonly startingMode: 'local' | 'remote';
    localLaunchFailure: LocalLaunchFailure | null = null;
    private resetConversationCallbacks: Array<() => Promise<void> | void> = [];
    private compactConversationCallbacks: Array<() => Promise<void> | void> = [];

    constructor(opts: {
        api: ApiClient;
        client: ApiSessionClient;
        path: string;
        logPath: string;
        sessionId: string | null;
        messageQueue: MessageQueue2<EnhancedMode>;
        onModeChange: (mode: 'local' | 'remote') => void;
        mode?: 'local' | 'remote';
        startedBy: 'runner' | 'terminal';
        startingMode: 'local' | 'remote';
        codexArgs?: string[];
        codexCliOverrides?: CodexCliOverrides;
        permissionMode?: PermissionMode;
    }) {
        super({
            api: opts.api,
            client: opts.client,
            path: opts.path,
            logPath: opts.logPath,
            sessionId: opts.sessionId,
            messageQueue: opts.messageQueue,
            onModeChange: opts.onModeChange,
            mode: opts.mode,
            sessionLabel: 'CodexSession',
            sessionIdLabel: 'Codex',
            applySessionIdToMetadata: (metadata, sessionId) => ({
                ...metadata,
                codexSessionId: sessionId
            }),
            permissionMode: opts.permissionMode
        });

        this.codexArgs = opts.codexArgs;
        this.codexCliOverrides = opts.codexCliOverrides;
        this.startedBy = opts.startedBy;
        this.startingMode = opts.startingMode;
        this.permissionMode = opts.permissionMode;
    }

    setPermissionMode = (mode: PermissionMode): void => {
        this.permissionMode = mode;
    };

    recordLocalLaunchFailure = (message: string, exitReason: LocalLaunchExitReason): void => {
        this.localLaunchFailure = { message, exitReason };
    };

    sendCodexMessage = (message: unknown): void => {
        this.client.sendCodexMessage(message);
    };

    sendUserMessage = (text: string): void => {
        this.client.sendUserMessage(text);
    };

    sendSessionEvent = (event: Parameters<ApiSessionClient['sendSessionEvent']>[0]): void => {
        this.client.sendSessionEvent(event);
    };

    clearSessionId = (): void => {
        this.sessionId = null;
    };

    addResetConversationCallback = (callback: () => Promise<void> | void): void => {
        this.resetConversationCallbacks.push(callback);
    };

    removeResetConversationCallback = (callback: () => Promise<void> | void): void => {
        const index = this.resetConversationCallbacks.indexOf(callback);
        if (index !== -1) {
            this.resetConversationCallbacks.splice(index, 1);
        }
    };

    resetConversation = async (): Promise<void> => {
        for (const callback of [...this.resetConversationCallbacks]) {
            await callback();
        }
        this.clearSessionId();
        this.client.resetConversationState();
    };

    addCompactConversationCallback = (callback: () => Promise<void> | void): void => {
        this.compactConversationCallbacks.push(callback);
    };

    removeCompactConversationCallback = (callback: () => Promise<void> | void): void => {
        const index = this.compactConversationCallbacks.indexOf(callback);
        if (index !== -1) {
            this.compactConversationCallbacks.splice(index, 1);
        }
    };

    compactConversation = async (): Promise<void> => {
        for (const callback of [...this.compactConversationCallbacks]) {
            await callback();
        }
    };
}
