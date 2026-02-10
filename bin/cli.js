#!/usr/bin/env node

import { Command } from "commander";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));

const program = new Command();

program
  .name("cursorbyemail")
  .description("Email-based conversations with Cursor agents")
  .version(pkg.version);

program
  .command("init")
  .description("Initialize cursorbyemail in your project")
  .action(async () => {
    const { init } = await import("../lib/init.js");
    await init();
  });

program
  .command("start")
  .description("Start the webhook server with ngrok tunnel")
  .option("-p, --port <port>", "Port for the webhook server", "8787")
  .action(async (options) => {
    const { start } = await import("../lib/start.js");
    await start({ port: parseInt(options.port, 10) });
  });

program.parse();
