import { createApp } from './app.mjs'
const dailyLimit = Number(process.env.FORGE_DAILY_REQUEST_LIMIT || 100)
if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1000) throw new Error('FORGE_DAILY_REQUEST_LIMIT must be an integer from 1 to 1000.')
const server = createApp({ key: process.env.NVIDIA_API_KEY?.trim(), dailyLimit })
server.requestTimeout = 150000
server.listen(3001, '127.0.0.1', () => console.log('Forge API listening on http://127.0.0.1:3001'))
