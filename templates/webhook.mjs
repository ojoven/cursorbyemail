import "dotenv/config";
import express from "express";
import { spawn } from "node:child_process";
import { Resend } from "resend";
const app = express();
app.use(express.json({ limit: "2mb" }));

// Map job ID to repository path (customize as needed)
function jobIdToRepoPath(jobId) {
	// Default to current workspace; extend with a lookup table if needed
	const mapping = {
		// "job123": "/path/to/repo",
	};
	return mapping[jobId] || process.env.DEFAULT_REPO_PATH || process.cwd();
}

// Extract email address from "Name <email>" format
function extractEmail(from) {
	const match = from.match(/<([^>]+)>/);
	return match ? match[1] : from;
}

// Render CLI output as HTML
function renderResultHtml(stdout) {
	const escaped = stdout
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
	return `<pre style="font-family:monospace;white-space:pre-wrap;">${escaped}</pre>`;
}

function stripQuotedReply(text = "") {
	// Remove quoted lines and email citation headers (English and Spanish)
	return text
		.split("\n")
		.filter((l) => !l.trim().startsWith(">"))
		.join("\n")
		.split(/\n\nOn .*wrote:\n/i)[0]          // English: "On ... wrote:"
		.split(/\n\nEl [^,]+,.*escribió:\n/i)[0] // Spanish: "El mié, 4 feb 2026...escribió:"
		.split(/\n\nEl [^,]+,/)[0]               // Spanish fallback: cut at "El día,"
		.trim();
}

app.post("/inbound/resend", async (req, res) => {
	try {
		const dryRun = req.query.dryRun === "true" || process.env.DRY_RUN === "true";

		if (dryRun) {
			console.log("Payload received:", JSON.stringify(req.body, null, 2));
		}

		// Resend inbound event payload includes the parsed email metadata.
		const event = req.body;
		const data = event?.data || {};
		const emailId = data?.email_id;

		// Fetch full email content via Resend Receiving API
		const resendClient = new Resend(process.env.RESEND_API_KEY);

		if (dryRun) {
			console.log("Email ID from webhook:", emailId);
		}

		// Use receiving API for inbound emails
		const fullEmail = await resendClient.emails.receiving.get(emailId);

		if (dryRun) {
			console.log("Full email received");
		}

		const subject = data?.subject || "";
		const to = (data?.to && data.to[0]) || "";
		const from = data?.from || "";

		// correlation: extract job ID (UUID) from subject like "[dcbd565f-6540-4794-b5e9-6e514346faa4]"
		const m = subject.match(/\[([a-f0-9-]{36})\]/i);
		if (!m) return res.status(200).json({ ok: true, ignored: "no job id" });
		const jobId = m[1];

		// Use text from Receiving API response
		const replyText = stripQuotedReply(fullEmail.data?.text || "");

		const repoPath = jobIdToRepoPath(jobId);
		const prompt = replyText;

		const cursorArgs = ["agent", "--resume", jobId, "--print", "--output-format", "json", prompt];
		const cursorCommand = {
			command: "cursor",
			args: cursorArgs,
			cwd: repoPath,
			full: `cursor agent --resume ${jobId} --print --output-format json ${JSON.stringify(prompt)}`,
		};

		// Always print the command
		console.log("Cursor command:", cursorCommand.full);
		console.log("Working directory:", cursorCommand.cwd);
		console.log("Command:", cursorCommand.command);
		console.log("Args:", cursorCommand.args.join(" "));

		if (dryRun) {
			return res.json({
				ok: true,
				dryRun: true,
				parsed: {
					jobId,
					from,
					to,
					subject,
					replyText,
					repoPath,
				},
				cursorCommand,
				email: {
					from: process.env.RESEND_FROM,
					to: extractEmail(from),
					subject,
				},
			});
		}

		// Run Cursor CLI using spawn for better control and real-time output
		console.log("Executing cursor command...");
		let stdout = "";
		let stderr = "";
		
		try {
			const child = spawn(
				cursorCommand.command,
				cursorCommand.args,
				{
					cwd: cursorCommand.cwd,
					env: { ...process.env }, // Inherit environment including PATH
					stdio: ['ignore', 'pipe', 'pipe'] // stdin: ignore, stdout: pipe, stderr: pipe
				}
			);

			// Collect stdout in real-time
			child.stdout.on('data', (data) => {
				const chunk = data.toString();
				stdout += chunk;
				console.log("[cursor stdout]", chunk);
			});

			// Collect stderr in real-time
			child.stderr.on('data', (data) => {
				const chunk = data.toString();
				stderr += chunk;
				console.error("[cursor stderr]", chunk);
			});

			// Wait for process to complete with timeout
			await new Promise((resolve, reject) => {
				// Set timeout
				const timeout = setTimeout(() => {
					child.kill('SIGTERM');
					reject(new Error(`Command timed out after 10 minutes`));
				}, 10 * 60 * 1000);

				// Handle process completion
				child.on('close', (code, signal) => {
					clearTimeout(timeout);
					console.log(`Command exited with code ${code}, signal ${signal}`);
					
					if (code === 0) {
						console.log("Command executed successfully");
						console.log("Stdout length:", stdout?.length || 0);
						if (stderr) {
							console.log("Stderr output:", stderr);
						}
						resolve();
					} else {
						const error = new Error(`Command failed with code ${code}${signal ? ` and signal ${signal}` : ''}`);
						error.code = code;
						error.signal = signal;
						error.stdout = stdout;
						error.stderr = stderr;
						reject(error);
					}
				});

				// Handle spawn errors
				child.on('error', (error) => {
					clearTimeout(timeout);
					console.error("Failed to spawn command:", error);
					reject(error);
				});
			});
		} catch (execError) {
			console.error("Command execution failed:");
			console.error("Error message:", execError.message);
			console.error("Error code:", execError.code);
			console.error("Error signal:", execError.signal);
			if (execError.stdout) {
				console.error("Stdout:", execError.stdout);
				stdout = execError.stdout; // Use stdout even on error if available
			}
			if (execError.stderr) {
				console.error("Stderr:", execError.stderr);
			}
			// Re-throw to be caught by outer catch block
			throw execError;
		}

		await resendClient.emails.send({
			from: process.env.RESEND_FROM,
			to: extractEmail(from),
			subject,
			html: renderResultHtml(stdout || ""),
		});

		console.log("Response email sent successfully");
		res.json({ ok: true });
	} catch (e) {
		console.error("Webhook error:", e);
		console.error("Error stack:", e.stack);
		
		// Try to send error notification email
		try {
			const resendClient = new Resend(process.env.RESEND_API_KEY);
			await resendClient.emails.send({
				from: process.env.RESEND_FROM,
				to: extractEmail(req.body?.data?.from || ""),
				subject: `Error: ${req.body?.data?.subject || "Cursor command failed"}`,
				html: `<pre>Error: ${e.message}\n\n${e.stack || ""}</pre>`,
			});
		} catch (emailError) {
			console.error("Failed to send error email:", emailError);
		}
		
		res.status(500).json({ ok: false, error: e.message });
	}
});

// Health check endpoint
app.get("/health", (req, res) => {
	res.json({ ok: true, timestamp: new Date().toISOString() });
});

const port = process.env.WEBHOOK_PORT || 8787;
app.listen(port, () => {
	console.log(`Webhook server listening on port ${port}`);
});
