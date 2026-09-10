import { test } from 'node:test'
import assert from 'node:assert/strict'
import { database, initialize } from '../../db.ts'
test('application data can be written and read in a rolled-back transaction', async () => {
  const pool = database()
  try {
    await initialize()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const created = await client.query(
        'INSERT INTO items(title,body) VALUES($1,$2) RETURNING id',
        ['Synthetic acceptance item', 'Temporary test data']
      )
      const read = await client.query('SELECT title FROM items WHERE id=$1', [created.rows[0].id])
      assert.equal(read.rows[0].title, 'Synthetic acceptance item')
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
})
