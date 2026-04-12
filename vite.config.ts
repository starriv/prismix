import { execSync } from "child_process";
import path from "path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";

const API_PORT = Number(process.env.PORT || 3403);
const DEV_PORT = Number(process.env.VITE_DEV_PORT || 5189);

// Inject git remote URL at build time (empty string if not available)
function getGitRepoUrl(): string {
  try {
    const raw = execSync("git remote get-url origin", { encoding: "utf8" }).trim();
    // Convert SSH URLs to HTTPS and strip .git suffix
    return raw.replace(/^git@([^:]+):(.+)$/, "https://$1/$2").replace(/\.git$/, "");
  } catch {
    return "";
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    process.env.ANALYZE === "true" &&
      visualizer({ open: true, gzipSize: true, filename: "dist/bundle-stats.html" }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: DEV_PORT,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  define: {
    __GIT_REPO_URL__: JSON.stringify(getGitRepoUrl()),
    __GATEWAY_ORIGIN__: JSON.stringify(process.env.DOMAIN ? `https://${process.env.DOMAIN}` : ""),
    __API_PORT__: JSON.stringify(API_PORT),
  },
  build: {
    outDir: "dist/web",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
          ui: ["class-variance-authority", "clsx", "tailwind-merge", "lucide-react"],
          i18n: ["i18next", "react-i18next", "i18next-browser-languagedetector"],
          // Web3 (wagmi, viem, rainbowkit) is NOT listed here — Vite code-splits
          // it behind the dynamic import() in WalletProvider so that homepage,
          // docs, and other public routes don't pay the ~380KB cost.
        },
      },
    },
  },
});
