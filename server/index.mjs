import { createApp } from './app.mjs'
const dailyLimit = Number(process.env.FORGE_DAILY_REQUEST_LIMIT || 100)
if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1000) throw new Error('FORGE_DAILY_REQUEST_LIMIT must be an integer from 1 to 1000.')
const provider = process.env.FORGE_PROVIDER || 'nvidia'
const key = (provider === 'deepseek' ? process.env.DEEPSEEK_API_KEY : process.env.NVIDIA_API_KEY)?.trim()
const server = createApp({ key, provider, dailyLimit, timeoutMs: 240000 })
server.requestTimeout = 270000
server.listen(3001, '127.0.0.1', () => console.log('Forge API listening on http://127.0.0.1:3001'))
