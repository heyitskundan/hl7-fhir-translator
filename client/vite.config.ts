import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves a project site at https://<user>.github.io/<repo>/, so the
// build needs that subpath baked in; local dev stays at the server root.
const base = process.env.GITHUB_PAGES ? "/hl7-fhir-translator/" : "/";

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
  },
});
