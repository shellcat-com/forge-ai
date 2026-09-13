import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { schemaSQL, supabaseStarterFiles } from './supabase-starter.ts'

describe('Supabase starter database', () => {
  it('enforces ownership for reads, writes, reassignment, and anonymous access', async () => {
    const db = new PGlite()
    try {
      await db.exec(`create role anon; create role authenticated; create schema auth;
        create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        grant usage on schema auth to authenticated, anon;
        insert into auth.users values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');`)
      await db.exec(schemaSQL)
      await db.exec(`set role authenticated; set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
        insert into public.forge_notes(id,user_id,body) values ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','Private note');`)
      expect((await db.query('select * from public.forge_notes')).rows).toHaveLength(1)
      await expect(db.exec(`update public.forge_notes set user_id='00000000-0000-4000-8000-000000000002'`)).rejects.toThrow()
      await db.exec(`set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002'`)
      expect((await db.query('select * from public.forge_notes')).rows).toHaveLength(0)
      expect((await db.query(`update public.forge_notes set body='stolen' returning id`)).rows).toHaveLength(0)
      expect((await db.query('delete from public.forge_notes returning id')).rows).toHaveLength(0)
      await expect(db.exec(`insert into public.forge_notes(user_id,body) values ('00000000-0000-4000-8000-000000000001','forged')`)).rejects.toThrow()
      await db.exec(`reset role; set role anon; set request.jwt.claim.sub = ''`)
      await expect(db.query('select * from public.forge_notes')).rejects.toThrow()
      await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001'`)
      expect((await db.query(`update public.forge_notes set body='Updated' returning body`)).rows).toEqual([{ body: 'Updated' }])
      expect((await db.query('delete from public.forge_notes returning id')).rows).toHaveLength(1)
    } finally { await db.close() }
  })
  it('provides a runnable starter with only environment placeholders and pinned dependencies', () => {
    const files = supabaseStarterFiles()
    expect(JSON.parse(files['package.json']).dependencies['@supabase/supabase-js']).toBe('2.116.0')
    expect(files['.env.example']).toContain('YOUR_PUBLISHABLE_KEY')
    expect(files['src/main.js']).toContain('signInWithPassword')
    expect(files['src/main.js']).not.toContain('innerHTML')
  })
})
