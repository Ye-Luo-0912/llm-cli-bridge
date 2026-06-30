import * as fs from "fs";
import * as path from "path";

export const CLAUDE_RUNTIME_CONFIG_RELATIVE_PATH = path.join(".llm-bridge", "claude-runtime.json");

export interface ClaudeRuntimeConfigFile {
  readonly version?: number;
  readonly runtimeDir?: string;
  readonly claudeConfigDir?: string;
}

export interface ClaudeRuntimeConfigResolution {
  readonly source: "project-json" | "auto-detected" | "inherited" | "none";
  readonly configPath?: string;
  readonly runtimeDir?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly envKeys: string[];
  readonly diagnostics: string[];
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function resolveFromVault(vaultPath: string, value: string): string {
  return path.normalize(path.isAbsolute(value) ? value : path.resolve(vaultPath, value));
}

function readProjectRuntimeConfig(vaultPath: string): { configPath: string; config: ClaudeRuntimeConfigFile } | null {
  const configPath = path.join(vaultPath, CLAUDE_RUNTIME_CONFIG_RELATIVE_PATH);
  if (!fs.existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as ClaudeRuntimeConfigFile;
    return { configPath, config: parsed };
  } catch {
    return null;
  }
}

function resolveProjectJson(vaultPath: string): ClaudeRuntimeConfigResolution | null {
  const project = readProjectRuntimeConfig(vaultPath);
  if (!project) return null;

  const runtimeDir = project.config.runtimeDir
    ? resolveFromVault(vaultPath, project.config.runtimeDir)
    : undefined;
  const privateDir = runtimeDir ? path.join(runtimeDir, "private") : undefined;
  const claudeConfigDir = project.config.claudeConfigDir
    ? resolveFromVault(vaultPath, project.config.claudeConfigDir)
    : privateDir
      ? path.join(privateDir, "claude-config")
      : undefined;

  const env: NodeJS.ProcessEnv = {};
  const envKeys: string[] = [];
  const diagnostics: string[] = [];

  if (claudeConfigDir && isDirectory(claudeConfigDir)) {
    env.CLAUDE_CONFIG_DIR = claudeConfigDir;
    envKeys.push("CLAUDE_CONFIG_DIR");
  } else if (claudeConfigDir) {
    diagnostics.push("CLAUDE_CONFIG_DIR missing");
  }

  return {
    source: "project-json",
    configPath: project.configPath,
    runtimeDir,
    env,
    envKeys,
    diagnostics,
  };
}

function resolveAutoDetected(vaultPath: string): ClaudeRuntimeConfigResolution | null {
  const candidates = [
    path.join(vaultPath, "LLM-AgentRuntime"),
    path.join(vaultPath, "..", "LLM-AgentRuntime"),
  ];

  for (const runtimeDir of candidates.map((p) => path.normalize(p))) {
    const privateDir = path.join(runtimeDir, "private");
    const claudeConfigDir = path.join(privateDir, "claude-config");
    const env: NodeJS.ProcessEnv = {};
    const envKeys: string[] = [];

    if (isDirectory(claudeConfigDir)) {
      env.CLAUDE_CONFIG_DIR = claudeConfigDir;
      envKeys.push("CLAUDE_CONFIG_DIR");
    }
    if (envKeys.length > 0) {
      return {
        source: "auto-detected",
        runtimeDir,
        env,
        envKeys,
        diagnostics: [],
      };
    }
  }

  return null;
}

export function resolveClaudeRuntimeConfig(vaultPath: string, baseEnv: NodeJS.ProcessEnv = process.env): ClaudeRuntimeConfigResolution {
  const project = resolveProjectJson(vaultPath);
  if (project && project.envKeys.length > 0) return project;

  const detected = resolveAutoDetected(vaultPath);
  if (detected) return detected;

  const env: NodeJS.ProcessEnv = {};
  const envKeys: string[] = [];
  if (baseEnv.CLAUDE_CONFIG_DIR) {
    env.CLAUDE_CONFIG_DIR = baseEnv.CLAUDE_CONFIG_DIR;
    envKeys.push("CLAUDE_CONFIG_DIR");
  }
  if (envKeys.length > 0) {
    return {
      source: "inherited",
      env,
      envKeys,
      diagnostics: project?.diagnostics ?? [],
    };
  }

  return {
    source: "none",
    env,
    envKeys,
    diagnostics: project?.diagnostics ?? [],
  };
}

export function applyClaudeRuntimeEnv(env: NodeJS.ProcessEnv, clearMissing: boolean = false): () => void {
  const keys = ["CLAUDE_CONFIG_DIR", "ANTHROPIC_CONFIG_DIR"];
  const previous = new Map<string, string | undefined>();
  for (const key of keys) {
    previous.set(key, process.env[key]);
    const value = env[key];
    if (value) {
      process.env[key] = value;
    } else if (clearMissing || key === "ANTHROPIC_CONFIG_DIR") {
      delete process.env[key];
    }
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
