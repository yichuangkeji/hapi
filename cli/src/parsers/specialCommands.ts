/**
 * Parsers for special commands that require dedicated remote session handling
 */

export interface CompactCommandResult {
    isCompact: boolean;
    originalMessage: string;
}

export interface ClearCommandResult {
    isClear: boolean;
}

export interface SpecialCommandResult {
    type: 'compact' | 'clear' | null;
    originalMessage?: string;
}

/**
 * Parse /compact command
 * Matches messages starting with "/compact " or exactly "/compact".
 * "/compat" is accepted as a web/backward-compatible alias and normalized to "/compact".
 */
export function parseCompact(message: string): CompactCommandResult {
    const trimmed = message.trim();
    const normalizeAlias = (value: string): string => value === '/compat'
        ? '/compact'
        : value.startsWith('/compat ')
            ? `/compact ${value.slice('/compat '.length)}`
            : value;
    
    if (trimmed === '/compact' || trimmed === '/compat') {
        return {
            isCompact: true,
            originalMessage: normalizeAlias(trimmed)
        };
    }
    
    if (trimmed.startsWith('/compact ') || trimmed.startsWith('/compat ')) {
        return {
            isCompact: true,
            originalMessage: normalizeAlias(trimmed)
        };
    }
    
    return {
        isCompact: false,
        originalMessage: message
    };
}

/**
 * Parse /clear command
 * Only matches exactly "/clear"
 */
export function parseClear(message: string): ClearCommandResult {
    const trimmed = message.trim();
    
    return {
        isClear: trimmed === '/clear'
    };
}

/**
 * Unified parser for special commands
 * Returns the type of command and original message if applicable
 */
export function parseSpecialCommand(message: string): SpecialCommandResult {
    const compactResult = parseCompact(message);
    if (compactResult.isCompact) {
        return {
            type: 'compact',
            originalMessage: compactResult.originalMessage
        };
    }
    
    const clearResult = parseClear(message);
    if (clearResult.isClear) {
        return {
            type: 'clear'
        };
    }
    
    return {
        type: null
    };
}
