import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VERSION } from '@qa-brain/core';
import { Command, InvalidArgumentError } from 'commander';
import { doctorCommand } from './commands/doctor.js';
import { serveCommand } from './commands/serve.js';
import { toolsListCommand } from './commands/tools.js';

function integer(value: string): number {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw new InvalidArgumentError('expected an integer');
  return n;
}

export function buildCli(): Command {
  const program = new Command();
  program
    .name('qa-brain')
    .description(
      'QA Brain — an MCP gateway that gives LLM agents persistent, self-healing, change-aware testing tools',
    )
    .version(VERSION, '-v, --version')
    .showHelpAfterError();

  program
    .command('serve', { isDefault: true })
    .description('serve the gateway over stdio (default) or Streamable HTTP')
    .option('-t, --transport <kind>', 'stdio | http', 'stdio')
    .option('-c, --config <path>', 'path to qa-brain.config.json|yaml')
    .option('-p, --port <port>', 'HTTP port', integer)
    .option('--host <host>', 'HTTP bind address')
    .option('--allow-unauthenticated', 'serve HTTP without a bearer token (loopback binds only)')
    .option('--log-level <level>', 'trace | debug | info | warn | error | silent')
    .option('--dry-run', 'start upstreams, print the resolved tool surface and exit')
    .action(async (opts) => {
      if (opts.transport !== 'stdio' && opts.transport !== 'http') {
        program.error(`--transport must be "stdio" or "http" (got "${opts.transport}")`);
      }
      process.exitCode = await serveCommand(opts);
    });

  program
    .command('doctor')
    .description('check the local environment: Node, config, store, Playwright, browsers, credentials')
    .option('-c, --config <path>', 'path to qa-brain.config.json|yaml')
    .action(async (opts) => {
      process.exitCode = await doctorCommand(opts);
    });

  const tools = program.command('tools').description('inspect the tool surface');
  tools
    .command('list', { isDefault: true })
    .description('list the tools the model will see (add --all for hidden, blocked and stub tools)')
    .option('-c, --config <path>', 'path to qa-brain.config.json|yaml')
    .option('-a, --all', 'include hidden, blocked and stub tools')
    .option('--json', 'machine-readable output')
    .action(async (opts) => {
      process.exitCode = await toolsListCommand(opts);
    });

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildCli();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    process.stderr.write(`qa-brain: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

/** True when this file is the process entry point (not imported by a test). */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  void main();
}
