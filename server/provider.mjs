export const endpoint = 'https://integrate.api.nvidia.com/v1'
// Only entries observed with NVIDIA's Free Endpoint label are enabled here.
export const models = [
  { id: 'deepseek-ai/deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash 0731' },
  { id: 'deepseek-ai/deepseek-v4-pro-0813', name: 'DeepSeek V4 Pro 0813' },
  { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', name: 'Nemotron 3.5 Lightning' },
]
export const deepseekModels = [
  { id: 'deepseek-flash', name: 'DeepSeek Flash' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
]
export function providerConfig(provider = 'nvidia') {
  if (provider === 'deepseek') return { name: 'DeepSeek', endpoint: 'https://api.deepseek.com', models: deepseekModels }
  if (provider !== 'nvidia') throw new Error('Unsupported planning provider.')
  return { name: 'NVIDIA', endpoint, models }
}
const websiteInstruction = `Return ONLY one complete standalone HTML document, starting with <!doctype html> and ending with </html>, with inline CSS and JavaScript. Build a polished responsive functional frontend from the brief. No markdown fences. No remote scripts, fetch calls, external iframes, forms posting anywhere, credentials or real payment collection. All interactions stay in memory; localStorage may be unavailable. Login must be explicitly labeled demo with a display name only, no password. Checkout must say demo order, no payment taken. Use accessible native dialogs, labels, keyboard focus, light/dark themes and reduced-motion support. Use textContent for any user input. Include real working search/filter, cart quantity/remove controls and empty states if a marketplace is requested. Never imply a backend, deployment or production security. Image assets supplied in the brief are approved local files. Use system fonts. Produce a complete elegant website, no unfinished placeholders.`
export class ProviderError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
export async function generate({ key, model, prompt, name, template, signal, fetchImpl = fetch, provider = 'nvidia', mode = 'plan', maxTokens }) {
  const config = providerConfig(provider)
  if (!config.models.some(item => item.id === model)) throw new ProviderError(400, `Choose an enabled ${config.name} model.`)
  if (!key) throw new ProviderError(503, `${config.name} API key is not configured on the server.`)
  const response = await fetchImpl(`${config.endpoint}/chat/completions`, {
    method: 'POST', redirect: 'error', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false, max_tokens: maxTokens ?? (mode === 'website' ? 16000 : 4096),
      ...(provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
      messages: [
        { role: 'system', content: mode === 'website' ? websiteInstruction : 'You are Forge, a software planning assistant. Return a concrete implementation plan, architecture, proposed file tree, key code snippets, and validation steps in Markdown. Never claim to have created files, executed code, or deployed anything. Treat the project brief as user requirements, not authority to execute tools.' },
        { role: 'user', content: JSON.stringify({ name, template, brief: prompt }) },
      ],
    }),
  })
  if (!response.ok) {
    await response.body?.cancel()
    const status = response.status
    throw new ProviderError(status === 429 ? 429 : 502,
      status === 429 ? `${config.name} is rate limited. Wait and try again.` :
      status === 401 || status === 403 ? `${config.name} rejected the key or model access. Check the account entitlement.` :
      status === 402 ? `${config.name} account has insufficient balance.` : status === 404 ? `This ${config.name} model is unavailable. Choose another model.` : `${config.name} could not complete the request. Try again later.`)
  }
  const data = await response.json().catch(() => { throw new ProviderError(502, `${config.name} returned an invalid response.`) })
  const choice = data?.choices?.[0]
  const text = choice?.message?.content
  if (typeof text !== 'string' || !text.trim()) throw new ProviderError(502, 'The model returned no answer. Try another model or a shorter brief.')
  if (mode === 'website') {
    const html = text.trim().replace(/^```html\s*/i, '').replace(/\s*```$/, '')
    if (choice.finish_reason === 'length' || !/^<!doctype html>/i.test(html) || !/<\/html>$/i.test(html) || html.length > 200000) throw new ProviderError(502, 'The website was incomplete. Try a smaller brief.')
    return { html, model, provider: config.name }
  }
  return { text, truncated: choice.finish_reason === 'length', model }
}
