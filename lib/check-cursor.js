import { execFile } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";

const execFileAsync = promisify(execFile);

export async function checkCursorCli() {
  try {
    const { stdout } = await execFileAsync("cursor", ["agent", "--version"], {
      timeout: 10000,
    });
    const version = stdout.trim();
    console.log(chalk.green(`✓ Cursor CLI found: ${version}`));
    return true;
  } catch (error) {
    console.log(chalk.yellow("⚠ Cursor CLI not found or not working"));
    console.log(chalk.dim("  The Cursor CLI is required for email reply functionality."));
    console.log(chalk.dim("  Install it from: https://cursor.com/es/docs/cli/installation"));
    console.log();
    return false;
  }
}
