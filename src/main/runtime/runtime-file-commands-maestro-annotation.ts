// @ts-nocheck -- follows the mechanically split runtime file-command class chain.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { resolveAuthorizedPath } from '../ipc/filesystem-auth'
import {
  getSshFilesystemProvider,
  SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE
} from '../providers/ssh-filesystem-dispatch'
import { RuntimeFileCommandsWithSearchRemoteQuickOpenFilePaths } from './runtime-file-commands-search-remote-quick-open-file-paths'

export class RuntimeFileCommandsWithMaestroAnnotation extends RuntimeFileCommandsWithSearchRemoteQuickOpenFilePaths {
  async createMaestroWorkspaceAnnotation(
    worktreeSelector: string,
    relativePath: string,
    content: string
  ): Promise<{ worktreeId: string; filePath: string }> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, relativePath)
    const provider = target.connectionId ? getSshFilesystemProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      try {
        await provider.createFile(target.path)
        await provider.writeFile(target.path, content)
      } catch (error) {
        if (!(error instanceof Error && /exist/i.test(error.message))) {
          throw error
        }
      }
      return { worktreeId: target.worktree.id, filePath: target.path }
    }
    const filePath = await resolveAuthorizedPath(target.path, this.host.requireStore())
    await mkdir(dirname(filePath), { recursive: true })
    try {
      await writeFile(filePath, content, { encoding: 'utf-8', flag: 'wx' })
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) {
        throw error
      }
    }
    return { worktreeId: target.worktree.id, filePath }
  }
}
