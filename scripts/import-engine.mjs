/** Explicit local-only, additive import. Source database and runtime remain untouched. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import pg from 'pg';
const sourcePath=process.argv[2],owner=process.argv[3],ids=process.argv.slice(4);
if(process.env.FORGE_AUTH_MODE==='hosted'||!sourcePath||!owner||!ids.length||ids.some(id=>! /^[a-f0-9-]{36}$/.test(id)))throw new Error('Usage in local mode: node --env-file=.env.local scripts/import-engine.mjs SOURCE_ENV OWNER PROJECT_ID...');
const sourceEnv=parseEnv(await readFile(sourcePath,'utf8'));
if(sourceEnv.DATABASE_URL===process.env.DATABASE_URL)throw new Error('Source and destination must differ.');
const source=new pg.Client({connectionString:sourceEnv.DATABASE_URL}),target=new pg.Client({connectionString:process.env.DATABASE_URL});
await source.connect();await target.connect();
try {
 await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const projects=(await source.query('SELECT * FROM forge_projects WHERE id=ANY($1)',[ids])).rows;
 if(projects.length!==ids.length)throw new Error('A requested source project is missing.');
 const revisions=(await source.query('SELECT * FROM forge_revisions WHERE project_id=ANY($1)',[ids])).rows;
 const jobs=(await source.query('SELECT * FROM forge_jobs WHERE project_id=ANY($1)',[ids])).rows;
 if(jobs.some(j=>['queued','running'].includes(j.status)))throw new Error('Wait for source jobs to finish before importing.');
 const events=(await source.query('SELECT e.* FROM forge_events e JOIN forge_jobs j ON j.id=e.job_id WHERE j.project_id=ANY($1) ORDER BY e.id',[ids])).rows;
 await source.query('COMMIT');
 await mkdir('.private',{recursive:true,mode:0o700});
 const backup=`.private/engine-import-${Date.now()}.json`;
 await writeFile(backup,JSON.stringify({projects,revisions,jobs,events}),{mode:0o600});
 const recovered=JSON.parse(await readFile(backup,'utf8'));
 if(recovered.revisions.length!==revisions.length)throw new Error('Private recovery copy verification failed.');
 await target.query('BEGIN');
 for(const p of projects){
  if((await target.query('SELECT id FROM forge_projects WHERE id=$1',[p.id])).rowCount)throw new Error('A destination ID already exists. No imported records were changed.');
  const prompt=jobs.find(j=>j.project_id===p.id&&j.kind==='generate')?.prompt||p.name;
  await target.query('INSERT INTO forge_projects(id,name,owner_id,brief,created_at,updated_at,last_opened_at,active_revision) VALUES($1,$2,$3,$4,$5,$5,$5,$6)',[p.id,p.name,owner,prompt,p.created_at,p.active_revision]);
 }
 for(const r of revisions)await target.query('INSERT INTO forge_revisions(id,project_id,files,database_snapshot,runtime_version,summary,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[r.id,r.project_id,JSON.stringify(r.files),r.database_snapshot,JSON.stringify(r.runtime_version),r.summary,r.created_at]);
 for(const j of jobs)await target.query('INSERT INTO forge_jobs(id,project_id,kind,prompt,provider,model,payload,status,error,created_at,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[j.id,j.project_id,j.kind,j.prompt,j.provider,j.model,JSON.stringify(j.payload),j.status,j.error,j.created_at,owner]);
 for(const e of events)await target.query('INSERT INTO forge_events(job_id,type,message,created_at) VALUES($1,$2,$3,$4)',[e.job_id,e.type,e.message,e.created_at]);
 // Event IDs are destination stream cursors; project, job and revision IDs are preserved.
 for(const r of revisions){const saved=(await target.query('SELECT files FROM forge_revisions WHERE id=$1',[r.id])).rows[0];for(const [path,content] of Object.entries(r.files))if(saved.files[path]!==content)throw new Error('Source verification failed.');}
 await target.query('COMMIT');console.log(JSON.stringify({importedProjectIds:ids,revisions:revisions.length,jobs:jobs.length,events:events.length,owner,sourceUnchanged:true,privateBackup:backup}));
} catch(error){await target.query('ROLLBACK').catch(()=>{});throw error;}finally{await source.end();await target.end();}
