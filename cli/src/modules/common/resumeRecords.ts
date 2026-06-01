import { readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { getProjectPath } from '@/claude/utils/path';
import { isObject } from '@hapi/protocol';

export type ResumeRecord = {
    id: string;
    agent: 'claude' | 'codex' | 'opencode';
    title?: string;
    cwd?: string;
    updatedAt?: number;
};

export interface ListResumeRecordsRequest {
    agent?: string;
}

export interface ListResumeRecordsResponse {
    success: boolean;
    records?: ResumeRecord[];
    error?: string;
}

const MAX_SCAN_FILES = 5000;
const MAX_TITLE_LENGTH = 120;

export async function listResumeRecords(agent: string, workingDirectory: string): Promise<ResumeRecord[]> {
    const resolvedAgent = normalizeAgent(agent);
    if (!resolvedAgent) {
        return [];
    }

    const records = resolvedAgent === 'claude'
        ? await listClaudeResumeRecords(workingDirectory)
        : resolvedAgent === 'codex'
            ? await listCodexResumeRecords(workingDirectory)
            : await listOpencodeResumeRecords(workingDirectory);

    return dedupeRecords(records)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function normalizeAgent(agent: string): ResumeRecord['agent'] | null {
    if (agent === 'claude' || agent === 'codex' || agent === 'opencode') {
        return agent;
    }
    return null;
}

function dedupeRecords(records: ResumeRecord[]): ResumeRecord[] {
    const byId = new Map<string, ResumeRecord>();
    for (const record of records) {
        const existing = byId.get(record.id);
        if (!existing || (record.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
            byId.set(record.id, record);
        }
    }
    return [...byId.values()];
}

async function listClaudeResumeRecords(workingDirectory: string): Promise<ResumeRecord[]> {
    const projectDir = getProjectPath(workingDirectory);
    const entries = await safeReadDir(projectDir);
    const files = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
        .slice(0, MAX_SCAN_FILES)
        .map((entry) => join(projectDir, entry.name));

    const records = await Promise.all(files.map(parseClaudeSessionFile));
    return records.filter((record): record is ResumeRecord => record !== null);
}

async function parseClaudeSessionFile(filePath: string): Promise<ResumeRecord | null> {
    const fileStat = await safeStat(filePath);
    const fallbackId = basename(filePath, '.jsonl');
    const raw = await safeReadFile(filePath);
    if (!raw) {
        return fallbackId ? { id: fallbackId, agent: 'claude', updatedAt: fileStat?.mtimeMs } : null;
    }

    let sessionId: string | null = fallbackId || null;
    let title: string | undefined;
    let updatedAt = fileStat?.mtimeMs;
    let cwd: string | undefined;

    for (const line of raw.split('\n')) {
        const record = parseJsonRecord(line);
        if (!record) {
            continue;
        }

        sessionId = getString(record.sessionId) ?? sessionId;
        cwd = getString(record.cwd) ?? cwd;

        const timestamp = parseTimestamp(record.timestamp);
        if (timestamp !== null) {
            updatedAt = Math.max(updatedAt ?? 0, timestamp);
        }

        if (!title && record.type === 'user') {
            const message = isObject(record.message) ? record.message as Record<string, unknown> : null;
            title = normalizeTitle(extractText(message?.content));
        }
    }

    if (!sessionId) {
        return null;
    }
    return { id: sessionId, agent: 'claude', title, cwd, updatedAt };
}

async function listCodexResumeRecords(workingDirectory: string): Promise<ResumeRecord[]> {
    const codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');
    const sessionsRoot = join(codexHome, 'sessions');
    const targetCwd = normalizePath(workingDirectory);
    const files = await listFilesRecursive(sessionsRoot, '.jsonl', MAX_SCAN_FILES);
    const sortedFiles = await sortFilesByMtime(files);
    const records: ResumeRecord[] = [];

    for (const filePath of sortedFiles) {
        const record = await parseCodexSessionFile(filePath, targetCwd);
        if (record) {
            records.push(record);
        }
    }

    return records;
}

async function parseCodexSessionFile(filePath: string, targetCwd: string): Promise<ResumeRecord | null> {
    const fileStat = await safeStat(filePath);
    const raw = await safeReadFile(filePath);
    if (!raw) {
        return null;
    }

    let sessionId: string | null = null;
    let cwd: string | null = null;
    let title: string | undefined;
    let updatedAt = fileStat?.mtimeMs;

    for (const line of raw.split('\n')) {
        const event = parseJsonRecord(line);
        if (!event) {
            continue;
        }

        const timestamp = parseTimestamp(event.timestamp);
        if (timestamp !== null) {
            updatedAt = Math.max(updatedAt ?? 0, timestamp);
        }

        const payload = isObject(event.payload) ? event.payload as Record<string, unknown> : null;
        if (event.type === 'session_meta' && payload) {
            sessionId = getString(payload.id) ?? sessionId;
            cwd = getString(payload.cwd) ?? cwd;
            const payloadTimestamp = parseTimestamp(payload.timestamp);
            if (payloadTimestamp !== null) {
                updatedAt = Math.max(updatedAt ?? 0, payloadTimestamp);
            }
        }

        if (!title && event.type === 'event_msg' && payload && getString(payload.type) === 'user_message') {
            title = normalizeTitle(
                getString(payload.message)
                ?? getString(payload.text)
                ?? getString(payload.content)
            );
        }
    }

    if (!sessionId || !cwd || normalizePath(cwd) !== targetCwd) {
        return null;
    }
    return { id: sessionId, agent: 'codex', title, cwd, updatedAt };
}

async function listOpencodeResumeRecords(workingDirectory: string): Promise<ResumeRecord[]> {
    const storageDir = resolveOpencodeStorageDir();
    const targetCwd = normalizePath(workingDirectory);
    const sessionInfoFiles = await listOpencodeSessionInfoFiles(storageDir);
    const records: ResumeRecord[] = [];

    for (const filePath of sessionInfoFiles.slice(0, MAX_SCAN_FILES)) {
        const fileStat = await safeStat(filePath);
        const record = parseOpencodeSessionInfo(await readJsonRecord(filePath));
        if (!record.id || !record.cwd || normalizePath(record.cwd) !== targetCwd) {
            continue;
        }
        records.push({
            id: record.id,
            agent: 'opencode',
            cwd: record.cwd,
            updatedAt: record.updatedAt ?? fileStat?.mtimeMs
        });
    }

    return records;
}

async function listOpencodeSessionInfoFiles(storageDir: string): Promise<string[]> {
    const sessionRoot = join(storageDir, 'session');
    const entries = await safeReadDir(sessionRoot);
    const files: string[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const projectDir = join(sessionRoot, entry.name);
        const projectFiles = await listJsonFiles(projectDir);
        files.push(...projectFiles);
    }

    return sortFilesByMtime(files);
}

function parseOpencodeSessionInfo(record: Record<string, unknown> | null): { id: string | null; cwd: string | null; updatedAt: number | null } {
    if (!record) {
        return { id: null, cwd: null, updatedAt: null };
    }
    const time = isObject(record.time) ? record.time as Record<string, unknown> : null;
    return {
        id: getString(record.id),
        cwd: getString(record.directory),
        updatedAt: time ? getNumber(time.updated) ?? getNumber(time.created) : null
    };
}

async function listJsonFiles(dirPath: string): Promise<string[]> {
    const entries = await safeReadDir(dirPath);
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => join(dirPath, entry.name));
}

async function listFilesRecursive(root: string, extension: string, maxFiles: number): Promise<string[]> {
    const results: string[] = [];

    async function walk(dir: string): Promise<void> {
        if (results.length >= maxFiles) {
            return;
        }
        const entries = await safeReadDir(dir);
        for (const entry of entries) {
            if (results.length >= maxFiles) {
                return;
            }
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
            } else if (entry.isFile() && entry.name.endsWith(extension)) {
                results.push(fullPath);
            }
        }
    }

    await walk(root);
    return results;
}

async function sortFilesByMtime(files: string[]): Promise<string[]> {
    const entries = await Promise.all(files.map(async (file) => ({
        file,
        mtimeMs: (await safeStat(file))?.mtimeMs ?? 0
    })));

    return entries
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .map((entry) => entry.file);
}

async function safeReadDir(dirPath: string): Promise<Dirent[]> {
    try {
        return await readdir(dirPath, { withFileTypes: true });
    } catch {
        return [];
    }
}

async function safeReadFile(filePath: string): Promise<string | null> {
    try {
        return await readFile(filePath, 'utf-8');
    } catch {
        return null;
    }
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown> | null> {
    const raw = await safeReadFile(filePath);
    if (!raw) {
        return null;
    }
    const parsed = parseJsonRecord(raw);
    return parsed;
}

async function safeStat(filePath: string): Promise<{ mtimeMs: number } | null> {
    try {
        return await stat(filePath);
    } catch {
        return null;
    }
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
    const trimmed = raw.trim();
    if (!trimmed) {
        return null;
    }
    try {
        const parsed = JSON.parse(trimmed);
        return isObject(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

function extractText(value: unknown): string | null {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        const parts = value
            .map((item) => {
                if (typeof item === 'string') {
                    return item;
                }
                if (isObject(item)) {
                    return getString((item as Record<string, unknown>).text);
                }
                return null;
            })
            .filter((part): part is string => Boolean(part));
        return parts.length > 0 ? parts.join(' ') : null;
    }
    return null;
}

function normalizeTitle(value: string | null): string | undefined {
    const normalized = value?.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return undefined;
    }
    return normalized.length > MAX_TITLE_LENGTH
        ? `${normalized.slice(0, MAX_TITLE_LENGTH - 3)}...`
        : normalized;
}

function normalizePath(value: string): string {
    const resolved = resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function parseTimestamp(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.length > 0) {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
}

function getString(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
    }
    return null;
}

function getNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    return null;
}

function resolveOpencodeStorageDir(): string {
    const base = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
    return join(base, 'opencode', 'storage');
}
