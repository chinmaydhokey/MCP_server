import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseConfig, type QaBrainConfig, type QaBrainConfigInput } from '@qa-brain/core';
import YAML from 'yaml';
import { defaultConfig } from './defaults.js';
import { expandEnv } from './expand-env.js';

export interface LoadedConfig {
  config: QaBrainConfig;
  /** Absolute path of the config file, or null when defaults were used. */
  configPath: string | null;
  /** Directory relative paths are resolved against (config dir or cwd). */
  baseDir: string;
  /** Absolute QA Brain home directory (`QA_BRAIN_HOME`, default `<baseDir>/.qa-brain`). */
  homeDir: string;
  /** Env-expanded values that must be redacted from logs. */
  secrets: string[];
}

export interface LoadConfigOptions {
  /** Explicit config path (CLI `--config`). Falls back to QA_BRAIN_CONFIG, then ./qa-brain.config.{json,yaml,yml}. */
  path?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** In-memory config (tests). Takes precedence over files. */
  inline?: QaBrainConfigInput;
}

const CANDIDATES = ['qa-brain.config.json', 'qa-brain.config.yaml', 'qa-brain.config.yml'];

function readConfigFile(file: string): unknown {
  const text = readFileSync(file, 'utf8');
  return file.endsWith('.json') ? JSON.parse(text) : YAML.parse(text);
}

function resolveFileUrl(url: string, baseDir: string): string {
  // libsql accepts `file:<path>`; make relative paths absolute so the CLI works from any cwd.
  if (!url.startsWith('file:') || url.startsWith('file::memory:') || url === ':memory:') return url;
  const p = url.slice('file:'.length);
  if (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)) return url;
  return `file:${path.resolve(baseDir, p)}`;
}

export function loadConfig(opts: LoadConfigOptions = {}): LoadedConfig {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();

  let raw: unknown;
  let configPath: string | null = null;
  if (opts.inline) {
    raw = opts.inline;
  } else {
    const explicit = opts.path ?? env.QA_BRAIN_CONFIG;
    if (explicit) {
      configPath = path.resolve(cwd, explicit);
      if (!existsSync(configPath)) throw new Error(`Config file not found: ${configPath}`);
      raw = readConfigFile(configPath);
    } else {
      const found = CANDIDATES.map((c) => path.resolve(cwd, c)).find((p) => existsSync(p));
      if (found) {
        configPath = found;
        raw = readConfigFile(found);
      } else {
        raw = defaultConfig();
      }
    }
  }

  const baseDir = configPath ? path.dirname(configPath) : cwd;
  const homeDir = path.resolve(baseDir, env.QA_BRAIN_HOME ?? './.qa-brain');
  const envWithHome: NodeJS.ProcessEnv = { ...env, QA_BRAIN_HOME: homeDir };

  const { value: expanded, expanded: secrets } = expandEnv(raw, envWithHome);
  const config = parseConfig(expanded);

  if (config.store.driver === 'sqlite') config.store.url = resolveFileUrl(config.store.url, baseDir);
  if (config.artifacts.driver === 'fs') config.artifacts.dir = path.resolve(baseDir, config.artifacts.dir);
  if (env.QA_BRAIN_LOG_LEVEL) {
    const lvl = env.QA_BRAIN_LOG_LEVEL as QaBrainConfig['log']['level'];
    config.log.level = lvl;
  }

  // The home dir itself is not a secret, but anything that came from the environment is treated as one.
  const filteredSecrets = secrets.filter((s) => s !== homeDir);
  return { config, configPath, baseDir, homeDir, secrets: filteredSecrets };
}
