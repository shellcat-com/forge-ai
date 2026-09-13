// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { IntegrationsWorkspace } from './workspace.ts'
vi.mock('../export.ts', () => ({ downloadFile: vi.fn() }))
it('keeps unavailable configuration idle until explicit retry', async () => {
 const api = vi.fn().mockRejectedValue(new Error('Offline'))
 const state = new IntegrationsWorkspace(api, ()=>{}, async ()=>{})
 await state.enter(); await state.enter();
 expect(api).toHaveBeenCalledTimes(1)
 expect(state.render()).toContain('Offline')
 await state.action('reload'); expect(api).toHaveBeenCalledTimes(2)
})
it('does not restore another account’s discovery configuration after clearing', async () => {
 let resolve!: (v: unknown) => void
 const api = vi.fn(()=>new Promise(r=>{resolve=r}))
 const state = new IntegrationsWorkspace(api as never, ()=>{}, async ()=>{})
 const pending=state.enter(); state.clear(); resolve({servers:[{id:'secret',name:'Private server',configured:true}],supabase:{configured:false}}); await pending
 expect(state.render()).not.toContain('Private server')
})
