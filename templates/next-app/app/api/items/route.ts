import { database } from "../../../lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  const db = database();
  try {
    return Response.json(
      db.prepare("SELECT * FROM items ORDER BY id DESC").all(),
    );
  } finally {
    db.close();
  }
}
export async function POST(request: Request) {
  const { title, body = "" } = await request.json();
  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.length > 200 ||
    typeof body !== "string" ||
    body.length > 10000
  )
    return Response.json({ error: "Invalid item" }, { status: 400 });
  const db = database();
  try {
    const result = db
      .prepare("INSERT INTO items (title, body) VALUES (?, ?)")
      .run(title, body);
    return Response.json(
      { id: Number(result.lastInsertRowid), title, body },
      { status: 201 },
    );
  } finally {
    db.close();
  }
}
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^\d+$/.test(id))
    return Response.json({ error: "Invalid id" }, { status: 400 });
  const db = database();
  try {
    db.prepare("DELETE FROM items WHERE id = ?").run(Number(id));
    return Response.json({ ok: true });
  } finally {
    db.close();
  }
}
