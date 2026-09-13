/// <reference types="vite/client" />
import { strToU8, zipSync } from 'fflate'
import starterLock from './supabase-starter-lock.json?raw'

export const schemaSQL = `-- Apply once in a new Supabase project using its SQL editor.
-- This is a starter schema, not an applied migration.
begin;
create table public.forge_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index forge_notes_user_id_idx on public.forge_notes(user_id);
alter table public.forge_notes enable row level security;
revoke all on public.forge_notes from anon, authenticated;
grant select, insert, update, delete on public.forge_notes to authenticated;
create policy notes_read on public.forge_notes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy notes_create on public.forge_notes for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy notes_edit on public.forge_notes for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy notes_delete on public.forge_notes for delete to authenticated
  using ((select auth.uid()) = user_id);
commit;
`

const app = `import { createClient } from '@supabase/supabase-js'
import './style.css'
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const status = document.querySelector('#status')
const authPanel = document.querySelector('#auth-panel')
const notesPanel = document.querySelector('#notes-panel')
const list = document.querySelector('#notes')
let user = null
let version = 0
const say = message => { status.textContent = message }
if (!/^https:\\/\\/[a-z0-9-]+\\.supabase\\.co\\/?$/.test(url || '') || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key || '')) {
  say('Set the project URL and publishable key in .env.local, then restart the development server.')
  document.querySelectorAll('button').forEach(button => { button.disabled = true })
} else {
  const db = createClient(url, key)
  async function loadNotes() {
    const current = version
    const { data, error } = await db.from('forge_notes').select('id,body,created_at').order('created_at', { ascending: false }).limit(100)
    if (current !== version) return
    if (error) throw error
    list.replaceChildren()
    for (const note of data) {
      const row = document.createElement('li')
      const input = document.createElement('textarea')
      input.value = note.body; input.maxLength = 4000
      input.setAttribute('aria-label', 'Note text')
      const save = document.createElement('button'); save.textContent = 'Save note'
      const remove = document.createElement('button'); remove.textContent = 'Delete note'
      save.onclick = () => perform(async () => {
        if (!input.value.trim()) throw new Error('Write a note before saving.')
        const { data, error } = await db.from('forge_notes').update({ body: input.value.trim() }).eq('id', note.id).select('id')
        if (error) throw error
        if (!data.length) throw new Error('This note is no longer available. Refresh your notes.')
        await loadNotes(); say('Note saved.')
      })
      remove.onclick = () => perform(async () => {
        const { error } = await db.from('forge_notes').delete().eq('id', note.id)
        if (error) throw error
        await loadNotes(); say('Note deleted.')
      })
      row.append(input, save, remove); list.append(row)
    }
    if (!data.length) list.textContent = 'No notes yet. Add your first note.'
  }
  async function perform(action) {
    document.querySelectorAll('button').forEach(button => { button.disabled = true })
    try { await action() } catch (error) { say(error.message || 'Request failed. Please retry.') }
    finally { document.querySelectorAll('button').forEach(button => { button.disabled = false }) }
  }
  async function showSession(session) {
    version++; user = session?.user || null
    authPanel.hidden = !!user; notesPanel.hidden = !user
    list.replaceChildren()
    if (user) { say('Signed in as ' + user.email); await perform(loadNotes) }
    else say('Sign in to view your private notes.')
  }
  db.auth.onAuthStateChange((_event, session) => { setTimeout(() => { void showSession(session) }, 0) })
  document.querySelector('#auth').onsubmit = event => {
    event.preventDefault()
    const form = event.currentTarget; const values = new FormData(form)
    const credentials = { email: String(values.get('email')), password: String(values.get('password')) }
    const signup = event.submitter?.value === 'signup'
    void perform(async () => {
      const { data, error } = signup ? await db.auth.signUp(credentials) : await db.auth.signInWithPassword(credentials)
      form.querySelector('[name=password]').value = ''
      if (error) throw error
      if (signup && !data.session) say('Check your email to confirm your account, then sign in.')
    })
  }
  document.querySelector('#new-note').onsubmit = event => {
    event.preventDefault()
    const form = event.currentTarget
    const body = String(new FormData(form).get('body')).trim()
    if (!user || !body) { say('Sign in and write a note first.'); return }
    const owner = user.id
    void perform(async () => {
      const { error } = await db.from('forge_notes').insert({ user_id: owner, body })
      if (error) throw error
      form.reset(); await loadNotes(); say('Note added.')
    })
  }
  document.querySelector('#signout').onclick = () => perform(async () => {
    const { error } = await db.auth.signOut()
    if (error) throw error
  })
  document.querySelector('#refresh').onclick = () => perform(loadNotes)
}
`

export function supabaseStarterFiles(): Record<string, string> {
  return {
    'package-lock.json': starterLock,
    'package.json': JSON.stringify({ name: 'forge-supabase-starter', private: true, version: '0.1.0', type: 'module', scripts: { dev: 'vite --host 127.0.0.1', build: 'vite build', preview: 'vite preview --host 127.0.0.1' }, dependencies: { '@supabase/supabase-js': '2.116.0' }, devDependencies: { vite: '7.1.4' }, engines: { node: '>=22' } }, null, 2),
    '.gitignore': 'node_modules/\ndist/\n.env*\n!.env.example\n',
    '.env.example': 'VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY\n',
    'schema.sql': schemaSQL,
    'src/main.js': app,
    'src/style.css': `:root{color-scheme:light dark;font:16px/1.6 system-ui;background:light-dark(#fdfcfc,#141111);color:light-dark(#201d1d,#f1eeee)}*{box-sizing:border-box}body{margin:0}main{max-width:720px;margin:auto;padding:48px 24px}h1{font-size:clamp(28px,5vw,42px)}label{display:grid;gap:8px;margin:16px 0}input,textarea,button{font:inherit;padding:12px;border:1px solid light-dark(#d8d3d3,#3a3434);border-radius:4px}input,textarea{width:100%;background:transparent;color:inherit}button{cursor:pointer;margin:8px 8px 8px 0;min-height:44px}button:disabled{opacity:.5}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid light-dark(#2563eb,#8ab4ff);outline-offset:3px}ul{list-style:none;padding:0}li{margin:24px 0;padding:16px;border:1px solid light-dark(#d8d3d3,#3a3434)}[hidden]{display:none!important}#status{min-height:28px;overflow-wrap:anywhere}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`,
    'index.html': `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private notes — Forge starter</title></head><body><main><p>FORGE / SUPABASE STARTER</p><h1>A space for your notes.</h1><p id="status" role="status">Connecting…</p><section id="auth-panel"><h2>Your account</h2><form id="auth"><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" autocomplete="current-password" minlength="8" maxlength="128" required></label><button value="signin">Sign in</button><button value="signup">Create account</button></form></section><section id="notes-panel" hidden><button id="signout">Sign out</button><button id="refresh">Refresh notes</button><form id="new-note"><label>New note<textarea name="body" required maxlength="4000"></textarea></label><button>Add note</button></form><h2>Your private notes</h2><ul id="notes"></ul></section></main><script type="module" src="/src/main.js"></script></body></html>`,
    'README.md': `# Forge Supabase starter

A separate, runnable Vite application with Supabase email/password Auth and private notes CRUD. This does not add a backend to Forge's generated single-file HTML previews. No project, database, or account has been provisioned by downloading this archive.

## Run
1. Create a Supabase development project. In Authentication, enable email/password and configure Site URL and allowed redirect URLs for your local and eventual hosted site.
2. Apply schema.sql once using the SQL editor in that new project. It creates public.forge_notes, enables row-level security, explicitly grants authenticated access, and restricts all four operations to the row owner. If the table already exists, review your schema before applying; this script does not overwrite it.
3. Copy .env.example to .env.local and supply the project's URL and publishable key (sb_publishable_...). Never use a secret or service-role key. Publishable keys are designed for browser use; RLS enforces access.
4. Use Node 22 or newer. Run npm ci, then npm run dev. Versions are pinned in package.json and the included lockfile.
5. Create an account, confirm its email, sign in, and add/edit/delete a note. Refresh to confirm persistence. Run npm run build before hosting the dist directory. Set the same public environment variables at build time on your host.

## Verify before real use
- Test in two separate browser profiles with two users. User B must not read, edit, delete, or take ownership of user A's notes, including direct REST requests using A's note ID.
- Signed-out requests must not read or mutate notes. Confirm RLS and policies in the Supabase dashboard and run Security Advisor.
- Check email confirmation, invalid credentials, sign-out, connection failures, empty state, keyboard navigation, and mobile layout.
- This starter lists the most recent 100 notes. Add pagination for larger datasets.
- Storage, realtime subscriptions, password recovery, social login, billing, and production deployment are not included. Configure those explicitly for your application.

## Sources
https://supabase.com/docs/reference/javascript/auth-signup
https://supabase.com/docs/guides/database/postgres/row-level-security
https://supabase.com/docs/guides/getting-started/api-keys
`,
  }
}
export async function downloadSupabaseStarter() {
  const { downloadFile } = await import('../export.ts')
  const files = Object.fromEntries(Object.entries(supabaseStarterFiles()).map(([path, value]) => [path, strToU8(value)]))
  downloadFile('forge-supabase-starter.zip', zipSync(files).slice().buffer, 'application/zip')
}
