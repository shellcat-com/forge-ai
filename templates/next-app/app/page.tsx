"use client";
import { useEffect, useState } from "react";
type Item = { id: number; title: string; body: string };
export default function Page() {
  const [items, setItems] = useState<Item[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  async function refresh() {
    const response = await fetch("/api/items");
    if (response.ok) setItems(await response.json());
    else setError("Could not load items.");
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <main>
      <p className="eyebrow">YOUR OWN LITTLE CORNER</p>
      <h1>Make room for ideas.</h1>
      <p>A simple collection, built just for you.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const response = await fetch("/api/items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
          });
          if (response.ok) {
            setTitle("");
            await refresh();
          } else setError("Could not save item.");
        }}
      >
        <label htmlFor="title">A new idea</label>
        <div className="row">
          <input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
          />
          <button>Add idea</button>
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
      <section>
        {items.length ? (
          items.map((item) => (
            <article key={item.id}>
              <h2>{item.title}</h2>
              <button
                onClick={async () => {
                  await fetch(`/api/items?id=${item.id}`, { method: "DELETE" });
                  await refresh();
                }}
              >
                Remove
              </button>
            </article>
          ))
        ) : (
          <p>No ideas yet. Add your first one above.</p>
        )}
      </section>
    </main>
  );
}
