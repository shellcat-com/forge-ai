import { database, initialize } from '../../../lib/db'
export const dynamic = 'force-dynamic'
export async function GET() {
  await initialize()
  return Response.json((await database().query('SELECT * FROM items ORDER BY id DESC')).rows)
}
export async function POST(request: Request) {
  const { title, body = '' } = await request.json()
  if (
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > 200 ||
    typeof body !== 'string' ||
    body.length > 10000
  )
    return Response.json({ error: 'Invalid item' }, { status: 400 })
  await initialize()
  const result = await database().query('INSERT INTO items(title,body) VALUES($1,$2) RETURNING *', [
    title,
    body,
  ])
  return Response.json(result.rows[0], { status: 201 })
}
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id || !/^\d+$/.test(id)) return Response.json({ error: 'Invalid id' }, { status: 400 })
  await initialize()
  await database().query('DELETE FROM items WHERE id=$1', [id])
  return Response.json({ ok: true })
}
