import type { ConnectionStore } from './store'
export async function recoverModelJobs(store: ConnectionStore) {
  const interrupted = await store.database.query(
    "SELECT id,owner_id FROM forge_jobs WHERE status='running'"
  )
  for (const job of interrupted.rows) {
    await store.transaction({ id: job.owner_id, local: true }, async (tx) => {
      const current = await tx.query(
        "SELECT cancelled FROM forge_jobs WHERE id=$1 AND status='running' FOR UPDATE",
        [job.id]
      )
      if (!current.rows[0]) return
      const runs = await tx.query(
        'SELECT id FROM forge_model_runs WHERE owner_id=$1 AND job_id=$2 FOR UPDATE',
        [job.owner_id, job.id]
      )
      const run = runs.rows[0]
      if (run)
        await tx.query(
          "UPDATE forge_model_attempts SET status='unknown',error_code='WORKER_INTERRUPTED' WHERE owner_id=$1 AND run_id=$2 AND status='dispatched'",
          [job.owner_id, run.id]
        )
      const uncertain = run
        ? await tx.query(
            "SELECT id FROM forge_model_attempts WHERE owner_id=$1 AND run_id=$2 AND status IN ('unknown','rejected') LIMIT 1",
            [job.owner_id, run.id]
          )
        : null
      const resume = !!run && !uncertain?.rowCount && !current.rows[0].cancelled
      const status = current.rows[0].cancelled ? 'cancelled' : resume ? 'queued' : 'failed'
      const message = resume
        ? 'Worker recovered. Completed model stages will be replayed from saved results.'
        : 'Worker interrupted. No uncertain provider request will be repeated; start a new run after reviewing usage.'
      await tx.query('UPDATE forge_jobs SET status=$2,error=$3 WHERE id=$1', [
        job.id,
        status,
        resume ? null : message,
      ])
      if (run)
        await tx.query('UPDATE forge_model_runs SET status=$3 WHERE owner_id=$1 AND id=$2', [
          job.owner_id,
          run.id,
          resume ? 'running' : 'paused',
        ])
      await tx.query('INSERT INTO forge_events(job_id,type,message) VALUES($1,$2,$3)', [
        job.id,
        resume ? 'recovery' : 'error',
        message,
      ])
    })
  }
}
