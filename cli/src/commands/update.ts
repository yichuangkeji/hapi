import chalk from 'chalk'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CommandDefinition } from './types'

type UpdateOptions = {
    version: string
    repo: string
    installDir?: string
}

const DEFAULT_REPO = 'yichuangkeji/hapi'
const DEFAULT_VERSION = 'latest'

function showHelp(): void {
    console.log(`
${chalk.bold('hapi update')} - One-click install/update

${chalk.bold('Usage:')}
  hapi update
  hapi update --version v0.16.1-zqs.1
  hapi update --repo yichuangkeji/hapi
  hapi update --install-dir ~/.local/bin

${chalk.bold('Options:')}
  --version <tag|latest>   Target release tag (default: latest)
  --repo <owner/repo>      GitHub repository (default: yichuangkeji/hapi)
  --install-dir <path>     Install destination directory
  -h, --help               Show help
`)
}

function normalizeVersion(input: string): string {
    const trimmed = input.trim()
    if (!trimmed) {
        return DEFAULT_VERSION
    }
    if (trimmed === 'latest') {
        return trimmed
    }
    return trimmed.startsWith('v') ? trimmed : `v${trimmed}`
}

function parseArgs(args: string[]): UpdateOptions {
    let version = DEFAULT_VERSION
    let repo = DEFAULT_REPO
    let installDir: string | undefined

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === '--version') {
            const value = args[++i]
            if (!value) {
                throw new Error('Missing value for --version')
            }
            version = normalizeVersion(value)
            continue
        }
        if (arg === '--repo') {
            const value = args[++i]
            if (!value) {
                throw new Error('Missing value for --repo')
            }
            repo = value.trim()
            continue
        }
        if (arg === '--install-dir') {
            const value = args[++i]
            if (!value) {
                throw new Error('Missing value for --install-dir')
            }
            installDir = value.trim()
            continue
        }
        throw new Error(`Unknown argument: ${arg}`)
    }

    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
        throw new Error(`Invalid repo format: ${repo}`)
    }

    return { version, repo, installDir }
}

async function runCommand(command: string, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: 'inherit',
            env: process.env
        })

        child.once('error', (error) => {
            reject(error)
        })

        child.once('close', (code, signal) => {
            if (typeof code === 'number' && code === 0) {
                resolve()
                return
            }
            reject(new Error(`Command failed: ${command} ${args.join(' ')} (code=${code}, signal=${signal ?? 'none'})`))
        })
    })
}

async function runUpdate(options: UpdateOptions): Promise<void> {
    const installerUrl = `https://raw.githubusercontent.com/${options.repo}/main/scripts/install_hapi.sh`
    const tempDir = await mkdtemp(join(tmpdir(), 'hapi-update-'))
    const installerPath = join(tempDir, 'install_hapi.sh')

    try {
        await runCommand('curl', ['-fsSL', installerUrl, '-o', installerPath])

        const bashArgs = [installerPath, '--repo', options.repo, '--version', options.version]
        if (options.installDir) {
            bashArgs.push('--install-dir', options.installDir)
        }

        await runCommand('bash', bashArgs)
    } finally {
        await rm(tempDir, { recursive: true, force: true })
    }
}

export const updateCommand: CommandDefinition = {
    name: 'update',
    requiresRuntimeAssets: false,
    run: async ({ commandArgs }) => {
        try {
            if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
                showHelp()
                return
            }

            const options = parseArgs(commandArgs)
            await runUpdate(options)
            console.log(chalk.green('Update finished.'))
            console.log(chalk.gray('Tip: restart running hapi sessions/runner if needed.'))
        } catch (error) {
            console.error(chalk.red('Update failed:'), error instanceof Error ? error.message : 'Unknown error')
            process.exit(1)
        }
    }
}
