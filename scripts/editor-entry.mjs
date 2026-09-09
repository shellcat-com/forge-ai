/* global self, Worker */
export * from "../node_modules/monaco-editor/esm/vs/editor/editor.main.js";
self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    const name =
      label === "typescript" || label === "javascript"
        ? "typescript"
        : label === "json"
          ? "json"
          : ["css", "scss", "less"].includes(label)
            ? "css"
            : ["html", "handlebars", "razor"].includes(label)
              ? "html"
              : "worker";
    return new Worker(`/monaco/${name}.js`, { type: "module" });
  },
};
