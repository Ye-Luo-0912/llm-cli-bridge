// Shared esbuild helpers for presentation behavior tests (Agent B owned).

import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function bundleOpts(projectRoot, entry) {
  return {
    entryPoints: [join(projectRoot, "src", entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    external: ["obsidian"],
  };
}

/** Bundle and import runtime modules needed by CodexRunViewModel semantic tests. */
export async function loadCodexRunViewModelModules(projectRoot) {
  const esbuild = (await import("esbuild")).default;
  const bundles = {
    assistantView: join(projectRoot, ".test-presentation-assistant-view-temp.mjs"),
    agentRunDisplayModel: join(projectRoot, ".test-presentation-agent-run-display-model-temp.mjs"),
    codexRunViewModel: join(projectRoot, ".test-presentation-codex-run-view-model-temp.mjs"),
  };

  await esbuild.build({ ...bundleOpts(projectRoot, "runtime/core/assistantTurnView.ts"), outfile: bundles.assistantView });
  await esbuild.build({ ...bundleOpts(projectRoot, "runtime/core/agentRunDisplayModel.ts"), outfile: bundles.agentRunDisplayModel });
  await esbuild.build({ ...bundleOpts(projectRoot, "runtime/core/codexRunViewModel.ts"), outfile: bundles.codexRunViewModel });

  const assistantViewMod = await import(pathToFileURL(bundles.assistantView).href);
  const agentRunDisplayModelMod = await import(pathToFileURL(bundles.agentRunDisplayModel).href);
  const codexRunViewModelMod = await import(pathToFileURL(bundles.codexRunViewModel).href);

  return {
    bundles,
    buildAssistantTurnViewFromEvents: assistantViewMod.buildAssistantTurnViewFromEvents,
    buildAgentRunDisplayModel: agentRunDisplayModelMod.buildAgentRunDisplayModel,
    buildCodexRunViewModel: codexRunViewModelMod.buildCodexRunViewModel,
  };
}
