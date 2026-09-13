import { z } from 'zod'

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/)
export const catalogSchema = z.object({
  kind: z.enum(['templates', 'components']), fetchedAt: z.iso.datetime(), source: z.literal('https://parable-three.vercel.app/api/mcp'),
  items: z.array(z.object({ slug, name: z.string().max(200), pitch: z.string().max(4000).optional(), description: z.string().max(4000).optional(), stack: z.string().max(40).optional(), category: z.string().max(100).optional(), family: z.string().max(40).optional(), liveUrl: z.url().refine(value => value.startsWith('https://shellcat-com.github.io/')).optional() })).max(1000),
})
export type Catalog = z.infer<typeof catalogSchema>
export type CatalogItem = Catalog['items'][number]
export function designBrief(item: CatalogItem, kind: Catalog['kind']): string {
  return `Build an original website using the following Parable ${kind === 'templates' ? 'template' : 'component'} as a design reference.\n\nName: ${item.name}\nDirection: ${item.pitch || item.description || ''}\n${item.stack ? `Reference stack: ${item.stack}\n` : ''}Source: https://parable-three.vercel.app/${kind}/${item.slug}\n${item.liveUrl ? `Live reference: ${item.liveUrl}\n` : ''}\nAdapt the typography, composition, and interaction to my content. Include responsive layouts, keyboard access, paired themes, and reduced-motion support. A standalone HTML output must implement compatible native HTML/CSS/JS; React registry components need a separate React build. Do not claim that a reference link has been fetched or its source installed. Connect backend behavior only when the target service is configured and verified.`
}
export function mcpConfig(name: string, value: string) {
  const id = slug.parse(name)
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error('Use an HTTPS MCP URL without credentials, query parameters, or a fragment.')
  return { mcpServers: { [id]: { url: url.href } } }
}
export function installation(item: CatalogItem, kind: Catalog['kind']): string {
  slug.parse(item.slug)
  return kind === 'templates'
    ? `npx degit shellcat-com/${item.slug} my-site`
    : `npx shadcn@latest add https://parable-three.vercel.app/r/${item.slug}.json`
}
