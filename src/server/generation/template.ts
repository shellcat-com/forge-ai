import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { safePath } from './files'
import type { FileMap } from './files'
export async function templateFiles(): Promise<{
  editable: FileMap
  protected: FileMap
}> {
  const editable: FileMap = {}
  const protectedFiles: FileMap = {}
  async function visit(directory: string, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix + entry.name
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules')
          await visit(join(directory, entry.name), path + '/')
      } else if (entry.isFile())
        (safePath(path) ? editable : protectedFiles)[path] = await readFile(
          join(directory, entry.name),
          'utf8'
        )
    }
  }
  await visit(join(process.cwd(), 'templates/next-app'))
  return { editable, protected: protectedFiles }
}
