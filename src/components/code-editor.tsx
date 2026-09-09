"use client";
import Editor, { loader } from "@monaco-editor/react";
import { useEffect, useState } from "react";
let ready: Promise<void> | undefined;
function prepareEditor() {
  return (ready ??= (async () => {
    const url = "/monaco/editor.js";
    const monaco = await import(/* webpackIgnore: true */ url);
    loader.config({ monaco });
  })());
}
export default function CodeEditor({
  path,
  value,
  readOnly,
  onChange,
}: {
  path: string;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let mounted = true;
    void prepareEditor()
      .then(() => {
        if (mounted) setLoaded(true);
      })
      .catch(() => {
        if (mounted) setError(true);
      });
    return () => {
      mounted = false;
    };
  }, []);
  if (!loaded)
    return (
      <p role="status">
        {error
          ? "The local editor could not load. Refresh to retry."
          : "Loading local code editor…"}
      </p>
    );
  return (
    <>
      <link rel="stylesheet" href="/monaco/editor.css" />
      <Editor
        height="600px"
        path={path}
        language={
          path.endsWith(".css")
            ? "css"
            : path.endsWith(".json")
              ? "json"
              : "typescript"
        }
        value={value}
        theme="vs-dark"
        onChange={(value) => {
          if (value !== undefined) onChange(value);
        }}
        loading={<p role="status">Loading local code editor…</p>}
        options={{
          readOnly,
          automaticLayout: true,
          minimap: { enabled: false },
          fontFamily: "DM Mono, monospace",
          fontSize: 12,
          wordWrap: "on",
          scrollBeyondLastLine: false,
          accessibilitySupport: "on",
          ariaLabel: `Source editor for ${path}`,
          padding: { top: 16 },
        }}
      />
    </>
  );
}
