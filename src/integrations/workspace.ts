import { escapeHTML as e } from '../components/ui.ts'
import { downloadFile } from '../export.ts'
import { catalogSchema, designBrief, installation, mcpConfig, type Catalog, type CatalogItem } from './catalog.ts'
import './workspace.css'

type Api = <T>(path: string, method?: string, body?: unknown) => Promise<T>
type Configuration = { servers: { id: string; name: string; authentication: string; configured: boolean }[]; configError: boolean; supabase: { configured: boolean } }
type Discovery = { checkedAt: string; tools: { name: string; description?: string }[] }
export class IntegrationsWorkspace {
  private config?: Configuration
  private catalogs = new Map<string, Catalog>()
  private discovered = new Map<string, Discovery>()
  private kind: Catalog['kind'] = 'templates'
  private search = ''
  private filter = ''
  private busy = false
  private message = ''
  private failed = false
  private version = 0
  private loaded = false
  private mcpDraft = { name: '', url: '' }
  private supabaseCheckedAt = ''
  constructor(private api: Api, private changed: () => void, private useDesign: (item: CatalogItem, brief: string) => Promise<void>) {}
  clear() { this.mcpDraft = { name: '', url: '' }; this.supabaseCheckedAt = ''; this.search = ''; this.filter = ''; this.kind = 'templates'; this.version++; this.config = undefined; this.discovered.clear(); this.catalogs.clear(); this.loaded = false; this.busy = false; this.message = ''; this.failed = false }
  async enter() {
    if (this.loaded || this.busy) return
    // Attempt once per visit/session; a failed service needs an explicit retry.
    // The local router renders again on state changes and must not start a retry loop.
    this.loaded = true
    await this.run(async () => { const version = this.version; const config = await this.api<Configuration>('/integrations'); if (version === this.version) { this.config = config; this.loaded = true } })
  }
  private async run(action: () => Promise<void>) {
    if (this.busy) return
    const version = this.version
    this.busy = true; this.message = ''; this.failed = false; this.changed()
    try { await action() } catch (error) { if (version === this.version) { this.failed = true; this.message = error instanceof Error ? error.message : 'This action failed. Please retry.' } }
    finally { if (version === this.version) { this.busy = false; this.changed() } }
  }
  render(library = false) {
    return `<div class="integration-workspace" aria-busy="${this.busy}"><div class="integration-heading"><div><p class="eyebrow">FORGE / ${library ? 'DESIGN LIBRARY' : 'CONNECTIONS'}</p><h1>${library ? 'Find your next direction.' : 'Bring your tools together.'}</h1><p>${library ? 'Explore complete websites and motion components from Parable. Start a brief, preview the original, or take the installation guide with you.' : 'Discover design tools, check your backend, and prepare connections for your next project.'}</p></div><a class="button" href="#/${library ? 'integrations' : 'design-library'}">${library ? 'Connectors & MCP' : 'Explore design library'} →</a></div><p role="status" class="integration-status ${this.failed ? 'form-error' : ''}">${this.busy ? 'Working…' : e(this.message)}</p>${library ? this.library() : this.connections()}</div>`
  }
  private library() {
    const catalog = this.catalogs.get(this.kind)
    const filters = [...new Set(catalog?.items.map(item => item.stack || item.category || '').filter(Boolean))]
    const items = catalog?.items.filter(item => `${item.name} ${item.pitch || item.description} ${item.stack || ''} ${item.category || ''}`.toLowerCase().includes(this.search.toLowerCase()) && (!this.filter || (item.stack || item.category) === this.filter)) || []
    return `<div class="integration-actions"><button data-integration="kind" data-id="templates" aria-pressed="${this.kind === 'templates'}">Website templates</button><button data-integration="kind" data-id="components" aria-pressed="${this.kind === 'components'}">UI components</button><button data-integration="catalog" ${this.busy ? 'disabled' : ''}>${catalog ? 'Refresh catalog' : 'Load live catalog'}</button></div><form data-integration-form="search" class="integration-filters"><label>Search designs<input name="search" type="search" value="${e(this.search)}" maxlength="100" placeholder="Try editorial, audio, portfolio…"></label><label>${this.kind === 'templates' ? 'Stack' : 'Category'}<select name="filter"><option value="">All</option>${filters.map(value => `<option ${value === this.filter ? 'selected' : ''} value="${e(value)}">${e(value)}</option>`).join('')}</select></label><button>Search</button></form>${catalog ? `<p>${items.length} of ${catalog.items.length} ${this.kind} · Retrieved ${e(new Date(catalog.fetchedAt).toLocaleString())}</p>` : '<div class="integration-empty"><h2>A library that can grow.</h2><p>Load the current Parable catalog over MCP. Its designs are independent of Forge’s five built-in design studies.</p></div>'}<div class="integration-grid">${items.map(item => `<article class="integration-card">${this.kind === 'templates' ? `<img src="https://parable-three.vercel.app/templates/${item.slug}.jpg" alt="${e(item.name)} original template preview" width="640" height="400" loading="lazy" referrerpolicy="no-referrer">` : ''}<div><p class="eyebrow">${e(item.stack || item.category || '')} / PARABLE</p><h2>${e(item.name)}</h2><p>${e(item.pitch || item.description || '')}</p><div class="integration-actions">${item.liveUrl ? `<a href="${e(item.liveUrl)}" target="_blank" rel="noopener noreferrer">Live site ↗</a>` : `<a href="https://parable-three.vercel.app/components/${item.slug}" target="_blank" rel="noopener noreferrer">Component ↗</a>`}<button data-integration="use" data-id="${item.slug}" ${this.busy ? 'disabled' : ''}>Start with this design</button><button data-integration="guide" data-id="${item.slug}">Get source guide ↓</button></div></div></article>`).join('')}</div>${catalog && !items.length ? '<p>No matching designs. Try another search or stack.</p>' : ''}<p>Original previews and source belong to <a href="https://github.com/shellcat-com/parable" target="_blank" rel="noopener noreferrer">Parable</a>. Starting a brief carries the design description into generation; source installation and external previews remain separate.</p>`
  }
  private connections() {
    return `<section><h2>MCP servers</h2><p>Check a server to read its available tools. This release supports discovery; custom tool execution and OAuth sign-in are not yet available.</p>${!this.config ? `<p>The integration service has not loaded.</p><button data-integration="reload" ${this.busy ? 'disabled' : ''}>Retry service</button>` : ''}${this.config?.configError ? '<p class="form-error">The host MCP configuration is invalid. Fix FORGE_MCP_SERVERS and restart the API.</p>' : ''}<div class="integration-grid">${this.config?.servers.map(server => { const result = this.discovered.get(server.id); return `<article class="integration-card"><div><h3>${e(server.name)}</h3><p>${result ? `Discovery succeeded · ${result.tools.length} tools` : server.configured ? 'Ready to check' : 'Host credential required'}</p><button data-integration="discover" data-id="${e(server.id)}" ${this.busy || !server.configured ? 'disabled' : ''}>${result ? 'Check again' : 'Check connection'}</button>${result ? `<p>Checked ${e(new Date(result.checkedAt).toLocaleString())}</p><details><summary>Available tools</summary><ul>${result.tools.map(tool => `<li><strong>${e(tool.name)}</strong><p>${e(tool.description || 'No description provided.')}</p></li>`).join('')}</ul></details>` : ''}</div></article>` }).join('') || ''}</div></section><section><h2>Add a custom MCP server</h2><p>Export a connection file for an MCP client. To make discovery available here, add the server to the host configuration below and restart the API. Exporting does not establish a connection.</p><form data-integration-form="mcp"><label>Server ID<input name="name" required pattern="[a-z0-9][a-z0-9-]{0,99}" placeholder="my-design-library" value="${e(this.mcpDraft.name)}" maxlength="100"></label><label>HTTPS MCP endpoint<input name="url" type="url" required placeholder="https://example.com/mcp" value="${e(this.mcpDraft.url)}" maxlength="2000"></label><button>Download MCP configuration</button></form><details><summary>Host setup</summary><p>Add this server-side environment variable. Bearer credentials must be stored in the named host secret.</p><pre>FORGE_MCP_SERVERS=[{"id":"my-library","name":"My library","url":"https://example.com/mcp","tokenEnv":"MY_LIBRARY_TOKEN"}]</pre><p>Omit tokenEnv for public servers. Host-configured servers are shared with authenticated users on this host; use a credential limited to the metadata those users may see.</p></details></section><section><h2>Supabase backend</h2><p>Prepare a real Auth + database starter with owner-only row policies. Configure its environment, apply its schema, and test sign-in before using it with real data.</p><p>${this.supabaseCheckedAt ? `Auth checked ${e(new Date(this.supabaseCheckedAt).toLocaleString())} · Database unverified` : this.config?.supabase.configured ? 'Host configuration present · Not yet verified' : 'Host setup needed'}</p><div class="integration-actions"><button data-integration="supabase" ${this.busy || !this.config?.supabase.configured ? 'disabled' : ''}>Check Supabase Auth</button><button data-integration="starter">Download backend starter ↓</button><a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">Open Supabase ↗</a></div><details><summary>Connection setup</summary><pre>SUPABASE_URL=https://YOUR_PROJECT.supabase.co\nSUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY</pre><p>Set these on the API host and restart it. Use a publishable key, never a secret or service-role key. The Auth check does not verify database policies or provision a project.</p></details></section><section><h2>More services</h2><p>GitHub, Stripe, Figma, Slack, Notion, Linear, and deployment providers require their own authorization and execution adapters. Their remote MCP servers can be configured for discovery above; they are not active app integrations yet.</p><a href="https://supabase.com/docs/guides/ai-tools/mcp" target="_blank" rel="noopener noreferrer">Supabase MCP setup ↗</a></section>`
  }
  async action(action: string, id?: string) {
    if (action === 'kind' && (id === 'templates' || id === 'components')) { this.kind = id; this.search = ''; this.filter = ''; this.changed(); return }
    if (action === 'reload') { this.loaded = false; await this.enter(); return }
    if (this.busy) return
    await this.run(async () => {
      const version = this.version
      if (action === 'catalog') { const kind = this.kind; const catalog = catalogSchema.parse(await this.api('/integrations/parable?kind=' + kind)); if (version === this.version) this.catalogs.set(kind, catalog) }
      if (action === 'discover' && id) { this.discovered.delete(id); const result = await this.api<Discovery>('/integrations/mcp/' + encodeURIComponent(id) + '/discover', 'POST', {}); if (version === this.version) this.discovered.set(id, result) }
      if (action === 'supabase') { this.supabaseCheckedAt = ''; const result = await this.api<{ message: string; checkedAt: string }>('/integrations/supabase/check', 'POST', {}); if (version === this.version) { this.message = result.message; this.supabaseCheckedAt = result.checkedAt } }
      if (action === 'starter') { const { downloadSupabaseStarter } = await import('./supabase-starter.ts'); await downloadSupabaseStarter(); this.message = 'Starter downloaded. Follow README.md to configure and verify your backend.' }
      const item = this.catalogs.get(this.kind)?.items.find(item => item.slug === id)
      if (action === 'use' && item) await this.useDesign(item, designBrief(item, this.kind))
      if (action === 'guide' && item) { downloadFile(`parable-${item.slug}.md`, `# ${item.name}\n\n${designBrief(item, this.kind)}\n\n## Install source in your own project\n\n\`\`\`sh\n${installation(item, this.kind)}\n\`\`\`\n\nReview the source, dependencies, and upstream license before installation. Forge has not executed this command.\n`, 'text/markdown'); this.message = 'Source guide downloaded.' }
    })
  }
  submit(kind: string, values: FormData) {
    if (kind === 'search') { this.search = String(values.get('search') || ''); this.filter = String(values.get('filter') || ''); this.changed(); return }
    if (kind === 'mcp') {
      this.mcpDraft = { name: String(values.get('name')), url: String(values.get('url')) }
      try { const config = mcpConfig(this.mcpDraft.name, this.mcpDraft.url); downloadFile('mcp.json', JSON.stringify(config, null, 2)); this.failed = false; this.message = 'Configuration downloaded. No connection has been established.' }
      catch (error) { this.failed = true; this.message = error instanceof Error ? error.message : 'Check the MCP configuration.' }
      this.changed()
    }
  }
}
