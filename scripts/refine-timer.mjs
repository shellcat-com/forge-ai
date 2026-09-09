// One explicit manual benchmark request, never part of automated verification.
import { randomUUID } from 'node:crypto';
const base=process.env.FORGE_TEST_URL||'http://127.0.0.1:3002';
const id=process.env.FORGE_WORKFLOW_PROJECT;
if(!id)throw new Error('Set FORGE_WORKFLOW_PROJECT to the benchmark project.');
const detail=await fetch(`${base}/api/projects/${id}`).then(r=>r.json());
const result=await fetch(`${base}/api/projects/${id}/jobs`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({kind:'generate',provider:'groq',model:'openai/gpt-oss-20b',baseRevision:detail.project.activeRevision,idempotencyKey:randomUUID(),prompt:'Improve the Pomodoro behavior: automatically start the break after focus completes, persist focus and break duration settings plus completed sessions after reload, and validate durations between 1 and 120 minutes. Keep Start/Pause/Resume and Reset reliable. The settings dialog needs an accessible name, keyboard focus containment, Escape to close, and focus restored to Settings. Keep the cream visual direction and support 375px screens.'})});
console.log(result.status,await result.json());
