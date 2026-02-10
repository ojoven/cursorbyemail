import "dotenv/config";
import chalk from "chalk";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

async function getNgrokUrl(maxRetries = 10, delayMs = 500) {
	for (let i = 0; i < maxRetries; i++) {
		try {
			const response = await fetch("http://127.0.0.1:4040/api/tunnels");
			const data = await response.json();
			if (data.tunnels && data.tunnels.length > 0) {
				// Prefer https tunnel
				const httpsTunnel = data.tunnels.find(t => t.public_url.startsWith("https://"));
				return httpsTunnel ? httpsTunnel.public_url : data.tunnels[0].public_url;
			}
		} catch (e) {
			// ngrok API not ready yet
		}
		await new Promise(resolve => setTimeout(resolve, delayMs));
	}
	return null;
}

export async function start({ port = 8787 } = {}) {
	const webhookPort = parseInt(process.env.WEBHOOK_PORT, 10) || port;

	console.log();
	console.log(chalk.bold("cursorbyemail") + " - Starting webhook server");
	console.log(chalk.dim("─".repeat(60)));
	console.log();

	// Find webhook script
	const cwd = process.cwd();
	const webhookPaths = [
		join(cwd, ".cursor", "hooks", "webhook.mjs"),
		join(cwd, "webhook.mjs"),
	];

	let webhookPath = null;
	for (const p of webhookPaths) {
		if (existsSync(p)) {
			webhookPath = p;
			break;
		}
	}

	if (!webhookPath) {
		console.log(chalk.red("✗ webhook.mjs not found"));
		console.log(chalk.dim("  Run 'npx cursorbyemail init' first to set up your project"));
		process.exit(1);
	}

	console.log(chalk.dim(`Using webhook: ${webhookPath}`));
	console.log();

	// Start Express server
	console.log(chalk.bold("Starting webhook server..."));

	const serverProcess = spawn("node", [webhookPath], {
		env: { ...process.env, WEBHOOK_PORT: String(webhookPort) },
		stdio: ["inherit", "pipe", "pipe"],
		cwd,
	});

	serverProcess.stdout.on("data", (data) => {
		process.stdout.write(chalk.dim(`[server] ${data}`));
	});

	serverProcess.stderr.on("data", (data) => {
		process.stderr.write(chalk.red(`[server] ${data}`));
	});

	serverProcess.on("error", (err) => {
		console.log(chalk.red(`✗ Failed to start server: ${err.message}`));
		process.exit(1);
	});

	// Wait for server to start
	await new Promise((resolve) => setTimeout(resolve, 1500));

	console.log(chalk.green("✓") + ` Webhook server running on port ${webhookPort}`);
	console.log();

	// Start ngrok tunnel using CLI
	console.log(chalk.bold("Starting ngrok tunnel..."));

	const ngrokArgs = ["http", String(webhookPort)];
	
	const ngrokProcess = spawn("ngrok", ngrokArgs, {
		stdio: ["ignore", "pipe", "pipe"],
		detached: false,
	});

	let ngrokError = "";

	ngrokProcess.stderr.on("data", (data) => {
		ngrokError += data.toString();
	});

	ngrokProcess.on("error", (err) => {
		console.log(chalk.red(`✗ Failed to start ngrok: ${err.message}`));
		console.log(chalk.dim("  Make sure ngrok is installed and in your PATH"));
		console.log(chalk.dim("  Install: https://ngrok.com/download"));
		serverProcess.kill();
		process.exit(1);
	});

	ngrokProcess.on("exit", (code) => {
		if (code !== 0 && code !== null) {
			console.log(chalk.red(`✗ ngrok exited with code ${code}`));
			if (ngrokError) {
				console.log(chalk.dim(ngrokError.trim()));
			}
			serverProcess.kill();
			process.exit(1);
		}
	});

	// Wait for ngrok to start and get the public URL
	const url = await getNgrokUrl();

	if (!url) {
		console.log(chalk.red("✗ Failed to get ngrok tunnel URL"));
		console.log(chalk.dim("  Check if ngrok is configured correctly"));
		console.log(chalk.dim("  Run: ngrok config add-authtoken <your-token>"));
		ngrokProcess.kill();
		serverProcess.kill();
		process.exit(1);
	}

	console.log(chalk.green("✓") + " ngrok tunnel established");
	console.log();
	console.log(chalk.dim("─".repeat(60)));
	console.log();
	console.log(chalk.bold("Webhook URL:"));
	console.log(chalk.cyan.bold(`  ${url}/inbound/resend`));
	console.log();
	console.log(chalk.dim("Add this URL to your Resend webhook configuration:"));
	console.log(chalk.dim("  1. Go to Resend dashboard → Webhooks"));
	console.log(chalk.dim("  2. Add endpoint with URL above"));
	console.log(chalk.dim("  3. Select 'email.received' event"));
	console.log();
	console.log(chalk.yellow.bold("⚠  IMPORTANT: Keep this process running!"));
	console.log(chalk.yellow("   Terminating it will close the ngrok tunnel and"));
	console.log(chalk.yellow("   the webhook URL will stop receiving emails."));
	console.log();
	console.log(chalk.dim("Press Ctrl+C to stop"));

	// Handle shutdown
	const shutdown = () => {
		console.log();
		console.log(chalk.dim("Shutting down..."));
		ngrokProcess.kill();
		serverProcess.kill();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}
