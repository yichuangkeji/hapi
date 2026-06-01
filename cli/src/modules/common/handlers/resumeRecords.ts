import { logger } from '@/ui/logger'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import {
    listResumeRecords,
    type ListResumeRecordsRequest,
    type ListResumeRecordsResponse
} from '../resumeRecords'
import { getErrorMessage, rpcError } from '../rpcResponses'

export function registerResumeRecordHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    rpcHandlerManager.registerHandler<ListResumeRecordsRequest, ListResumeRecordsResponse>('listResumeRecords', async (data) => {
        logger.debug('List resume records request for agent:', data.agent)

        try {
            const records = await listResumeRecords(data.agent ?? 'claude', workingDirectory)
            return { success: true, records }
        } catch (error) {
            logger.debug('Failed to list resume records:', error)
            return rpcError(getErrorMessage(error, 'Failed to list resume records'))
        }
    })
}
