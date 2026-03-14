import { randomUUID } from 'node:crypto'
import { configuration } from '@/configuration'
import { updateSettings } from '@/persistence'
import { getMachineRegistrationScope } from '@/utils/accessToken'

export async function authAndSetupMachineIfNeeded(): Promise<{
    token: string
    machineId: string
}> {
    if (!configuration.cliApiToken) {
        throw new Error('CLI_API_TOKEN is required')
    }

    const machineRegistrationScope = getMachineRegistrationScope(configuration.apiUrl, configuration.cliApiToken)
    const settings = await updateSettings((current) => {
        if (!current.machineId || current.machineRegistrationScope !== machineRegistrationScope) {
            return {
                ...current,
                machineId: randomUUID(),
                machineRegistrationScope
            }
        }
        return current
    })

    if (!settings.machineId) {
        throw new Error('Failed to initialize machineId')
    }

    return { token: configuration.cliApiToken, machineId: settings.machineId }
}
