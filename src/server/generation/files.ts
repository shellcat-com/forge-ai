import { z } from 'zod'
export const safePath = (path: string) =>
  path.length <= 180 &&
  !path.includes('..') &&
  !path.split('/').some((part) => !part) &&
  /^(app\/(?:page\.tsx|globals\.css|(?:[a-zA-Z0-9_[\]-]+\/)+(?:page|layout|loading|error|not-found)\.tsx|components\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.tsx|api\/(?:[a-zA-Z0-9_[\]-]+\/)+route\.ts)|lib\/generated\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.ts)$/.test(
    path
  )
export const operationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('write'),
      path: z.string().refine(safePath, 'Unsafe or protected path'),
      content: z.string().max(64000),
    })
    .strict(),
  z
    .object({
      type: z.literal('delete'),
      path: z.string().refine(safePath, 'Unsafe or protected path'),
    })
    .strict(),
])
export const batchSchema = z
  .object({
    summary: z.string().min(1).max(500),
    operations: z.array(operationSchema).min(1).max(20),
  })
  .strict()
export type FileMap = Record<string, string>
export function validateFiles(files: FileMap): FileMap {
  if (Object.keys(files).length > 40 || Buffer.byteLength(JSON.stringify(files)) > 256000)
    throw new Error('Workspace file limit exceeded')
  for (const [path, content] of Object.entries(files))
    if (!safePath(path) || typeof content !== 'string' || Buffer.byteLength(content) > 64000)
      throw new Error('Unsafe file')
  if (!files['app/page.tsx'] || !files['app/globals.css'])
    throw new Error('Page and stylesheet are required')
  return files
}
export function applyBatch(
  previous: FileMap,
  output: unknown
): { files: FileMap; summary: string } {
  const batch = batchSchema.parse(output)
  const next = { ...previous }
  const seen = new Set<string>()
  for (const operation of batch.operations) {
    if (seen.has(operation.path)) throw new Error('Duplicate file operation')
    seen.add(operation.path)
    if (operation.type === 'write') next[operation.path] = operation.content
    else delete next[operation.path]
  }
  return { files: validateFiles(next), summary: batch.summary }
}
