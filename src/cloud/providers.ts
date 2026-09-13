import { escapeHTML as e } from '../components/ui.ts'

export interface Connections {
  enabled: boolean
  dailyLimit?: number
  requestsToday?: number
  providers: {
    id: 'deepseek' | 'nvidia'
    name: string
    connected: boolean
    fingerprint: string | null
    checkedAt: string | null
    models: { id: string; name: string }[]
  }[]
}
export const emptyConnections = (): Connections => ({ enabled: false, providers: [] })
const usage = (config: Connections) =>
  `<p>${config.requestsToday ?? 0} of ${config.dailyLimit ?? 20} requests used today. Resets at midnight UTC. Connection checks and failed attempts count toward this limit.</p>`

export function connectionsSettings(config: Connections): string {
  return `<section aria-labelledby="provider-title"><h2 id="provider-title">Your AI providers</h2><p>Connect your own API key to prepare text plans or generate a standalone frontend. Requests use your provider account and may incur charges.</p>${config.enabled ? `${usage(config)}<p>Keys are encrypted on the server and excluded from account exports. Forge never displays a saved key.</p>${config.providers.map((provider) => `<article class="cloud-provider"><h3>${e(provider.name)}</h3><p>${provider.connected ? `Connected · Key fingerprint ${e(provider.fingerprint || '')}` : 'No key connected'}</p><form data-form="connection" data-provider="${provider.id}" autocomplete="off"><label>${provider.connected ? 'Replacement' : 'New'} ${e(provider.name)} API key<input type="password" name="key" autocomplete="off" autocapitalize="none" spellcheck="false" minlength="10" maxlength="512" required></label><p>Check and save sends a small request to ${e(provider.name)} to confirm access. Your provider may charge for this check.</p><button>${provider.connected ? 'Check and replace key' : 'Check and save key'}</button></form>${provider.connected ? `<button data-cloud="remove-provider" data-provider="${provider.id}">Remove ${e(provider.name)} key</button>` : ''}</article>`).join('')}<p>Removing a key prevents future Forge requests. An in-flight request may finish. Revoke the key at your provider to disable it everywhere.</p>` : '<p>Provider connections are unavailable on this host. Your account and saved briefs still work.</p>'}</section>`
}

export function generationForm(config: Connections, selected = { providerModel: '', mode: 'plan' }): string {
  const connected = config.providers.filter((provider) => provider.connected)
  return `<section aria-labelledby="generation-title"><h2 id="generation-title">Build with your API key</h2><p>Send this saved brief to your selected provider. A frontend is one HTML file with an isolated preview and download. It has no backend, real login, payments, or deployment.</p>${connected.length ? `${usage(config)}<form data-form="generate"><div class="cloud-field"><label for="generation-model">Provider and model</label><select id="generation-model" name="providerModel">${connected.map((provider) => `<optgroup label="${e(provider.name)}">${provider.models.map((model) => `<option value="${e(provider.id + ':' + model.id)}" ${selected.providerModel === provider.id + ':' + model.id ? 'selected' : ''}>${e(model.name)}</option>`).join('')}</optgroup>`).join('')}</select></div><div class="cloud-field"><label for="generation-mode">Output</label><select id="generation-mode" name="mode"><option value="plan" ${selected.mode === 'plan' ? 'selected' : ''}>Text plan · up to 2,048 output tokens</option><option value="website" ${selected.mode === 'website' ? 'selected' : ''}>Standalone frontend · up to 8,000 output tokens</option></select></div><p>Your provider bills usage directly. These request and output limits are not a dollar spending cap. Set a spending limit at your provider; savings are not guaranteed.</p><button class="primary">Send brief and generate</button></form>` : '<p><a href="#/settings">Connect an API key in Settings</a> to generate from this brief.</p>'}</section>`
}
