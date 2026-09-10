import { provider } from '../providers/registry'
import { ProviderError, safeProviderError } from '../providers/errors'
import { applyBatch } from './files'
import { normalizeClientDirectives } from './normalize'
import type { FileMap } from './files'
const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'operations'],
  properties: {
    summary: {
      type: 'string',
    },
    operations: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'path', 'content'],
        properties: {
          type: {
            const: 'write',
          },
          path: {
            type: 'string',
          },
          content: {
            type: 'string',
          },
        },
      },
    },
  },
}
export async function generateFiles(
  input: { provider: string; model: string; prompt: string },
  files: FileMap,
  event: (type: string, message: string) => Promise<void>,
  signal?: AbortSignal
) {
  const manifest = Object.keys(files)
  const words = new Set(input.prompt.toLowerCase().match(/[a-z]{4,}/g) ?? [])
  const ranked = Object.entries(files).sort(
    ([a], [b]) =>
      Number(b === 'app/page.tsx') -
      Number(a === 'app/page.tsx') +
      [...words].filter((w) => b.includes(w)).length -
      [...words].filter((w) => a.includes(w)).length
  )
  const context: FileMap = {}
  let used = 0
  for (const [path, content] of ranked) {
    if (used + content.length > 48000) continue
    context[path] = content
    used += content.length
  }
  await event(
    'context',
    `Using ${Object.keys(context).length} of ${manifest.length} files. Unchanged files are retained.`
  )
  const prompt = `Project file manifest: ${JSON.stringify(manifest)}\nRelevant existing files: ${JSON.stringify(context)}\nYOUR TASK: ${input.prompt}\nReturn JSON with summary and operations. Each write includes type, path, and complete content. Preserve unchanged files by omitting them. Supported paths: app/page.tsx, app/globals.css, nested app/<route>/page.tsx and layout.tsx, app/components/**/*.tsx, app/api/**/route.ts, lib/generated/**/*.ts. Do not change protected configuration or app/layout.tsx.`
  async function attempt(id: string, model: string) {
    await event('provider', `Generating with ${id} / ${model}.`)
    let output = ''
    let lastUpdate = 0
    try {
      for await (const part of provider(id).generate(
        {
          model,
          prompt,
          maxTokens: 8192,
          json: true,
          schema,
          system:
            'Build polished, functional Next.js web applications in the visual direction requested by the user. Return only JSON file operations. Use React, next/link, next/navigation, and standard platform APIs; do not import uninstalled packages. Client components using hooks require a quoted "use client" directive. Next.js also renders client components on the server: never read localStorage, document, or window during module initialization or initial render; initialize browser persistence inside useEffect. Create additional routes, reusable components and server endpoints when needed. Implement only the requested product; a timer or portfolio does not need the generic items backend. For local persistent server data, the protected lib/db.ts exports the existing SQLite helper; inspect provided source before using it. Never claim authentication or payments work without an implemented backend. Use browser localStorage only for personal local data. Keep generated visuals independent from Forge. Never access control-process secrets, execute shell commands, or change infrastructure.',
        },
        signal
          ? AbortSignal.any([signal, AbortSignal.timeout(180000)])
          : AbortSignal.timeout(180000)
      )) {
        if (part.type === 'delta') {
          output += part.text
          if (output.length > 256000) throw new ProviderError('limit')
          if (Date.now() - lastUpdate > 1500) {
            await event(
              'progress',
              `Receiving file operations · ${output.length.toLocaleString()} characters`
            )
            lastUpdate = Date.now()
          }
        }
      }
    } catch (error) {
      throw safeProviderError(error)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(output)
    } catch {
      throw new Error(
        'The model did not return valid file operations. The working revision is unchanged.'
      )
    }
    try {
      const batch = applyBatch(files, parsed)
      const normalized = normalizeClientDirectives(batch.files)
      if (normalized.corrected)
        await event('repair', 'Corrected an unquoted React client directive before building.')
      return { ...batch, files: normalized.files }
    } catch {
      throw new Error(
        'Generated file operations failed validation. The working revision is unchanged.'
      )
    }
  }
  return attempt(input.provider, input.model)
}
