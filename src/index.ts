import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { explainPath, formatExplain, scanContextTree, type ContextScope } from "./context-tree.js";

const contextTree = (pi: ExtensionAPI) => {
  let scopes: ContextScope[] = [];

  async function reload(cwd: string) {
    scopes = await scanContextTree(cwd);
    return scopes;
  }

  pi.on("session_start", async (_event, ctx) => {
    try {
      await reload(ctx.cwd);
      ctx.ui.setStatus("context-tree", `context-tree ${scopes.length} scopes`);
    } catch (error) {
      ctx.ui.setStatus("context-tree", "context-tree error");
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
  });

  pi.registerCommand("context-tree", {
    description: "Inspect pi-context-tree state and folder-scoped context routing.",
    handler: async (args, ctx) => {
      const [command = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);

      if (command === "status") {
        ctx.ui.notify(`pi-context-tree loaded ${scopes.length} scope(s).`, "info");
        return;
      }

      if (command === "reload") {
        await reload(ctx.cwd);
        ctx.ui.setStatus("context-tree", `context-tree ${scopes.length} scopes`);
        ctx.ui.notify(`Reloaded ${scopes.length} context scope(s).`, "info");
        return;
      }

      if (command === "explain") {
        const targetPath = rest.join(" ");
        if (!targetPath) {
          ctx.ui.notify("Usage: /context-tree explain <path>", "warning");
          return;
        }
        const result = explainPath(ctx.cwd, scopes, targetPath);
        ctx.ui.notify(formatExplain(ctx.cwd, result), "info");
        return;
      }

      ctx.ui.notify(`Unknown context-tree command: ${command}`, "warning");
    },
  });
};

export default contextTree;
