import "dotenv/config";
import { Resend } from "resend";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
	beautifyPayloadToEmailHTML,
	extractLatestResponseFromPayload,
	getTranscriptPathFromPayload,
} from "./beautify-transcript-email-html.js";

function getProjectName(cwd = process.cwd()) {
	try {
		const top = execSync("git rev-parse --show-toplevel", {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
		if (top) return path.basename(top);
	} catch {
		// not a git repo or git not available
	}
	return path.basename(cwd);
}

const LOG_FILE = process.env.CURSOR_HOOK_LOG_FILE || ".cursor/hooks/hook.log";
const DEBUG = process.env.CURSOR_HOOK_DEBUG === "1";

function log(line) {
	const ts = new Date().toISOString();
	fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
	fs.appendFileSync(LOG_FILE, `[${ts}] ${line}\n`, "utf8");
}

function readStdin() {
	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => (data += chunk));
		process.stdin.on("end", () => resolve(data));
	});
}

function safeJson(obj) {
	try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
}

function readTranscriptFile(transcriptPath) {
	if (!transcriptPath) return "";
	try {
		return fs.readFileSync(transcriptPath, "utf8");
	} catch (e) {
		log(`Transcript read error: ${e?.message || e}`);
		return "";
	}
}

async function main() {
	log("Hook start");

	const enabled = process.env.CURSOR_EMAIL_ON_FINISH === "1";
	if (!enabled) {
		log("CURSOR_EMAIL_ON_FINISH!=1 -> exit");
		process.exit(0);
	}

	const raw = await readStdin();
	log(`stdin bytes=${Buffer.byteLength(raw || "", "utf8")}`);

	let payload = {};
	try {
		payload = raw ? JSON.parse(raw) : {};
	} catch (e) {
		log(`JSON parse error: ${e?.message || e}`);
		if (DEBUG) log(`RAW:\n${raw}`);
		process.exit(1);
	}

	if (DEBUG) log(`PAYLOAD:\n${safeJson(payload)}`);

	const to = process.env.CURSOR_EMAIL_TO;
	const from = process.env.RESEND_FROM;
	const replyTo = process.env.RESEND_REPLY_TO;
	const apiKey = process.env.RESEND_API_KEY;

	if (!to || !from || !apiKey) {
		log("Missing env vars: CURSOR_EMAIL_TO / RESEND_FROM / RESEND_API_KEY");
		process.exit(1);
	}

	const projectName = getProjectName();
	const projectPrefix = projectName ? `[${projectName}] ` : "";
	const baseSubject = process.env.CURSOR_EMAIL_SUBJECT ?? "Cursor agent finished";
	const conversationId = payload?.conversation_id || payload?.conversationId || "";
	const subject = conversationId
		? `${projectPrefix}${baseSubject} [${conversationId}]`
		: `${projectPrefix}${baseSubject}`;
	const text = extractLatestResponseFromPayload(payload, raw || "(empty hook payload)");
	const transcriptPath = getTranscriptPathFromPayload(payload);
	const transcriptText = readTranscriptFile(transcriptPath);
	const html = beautifyPayloadToEmailHTML(payload, {
		title: `${projectPrefix}Full transcript`,
		transcriptText,
		latestResponse: text,
		transcriptPath,
	});

	if (process.env.CURSOR_DRY_RUN === "1") {
		log(`DRY_RUN=1 subject="${subject}" to="${to}" from="${from}" body_len=${text.length} html_len=${html.length}`);
		process.exit(0);
	}

	const resend = new Resend(apiKey);
	const result = await resend.emails.send({ from, to, subject, text, html, replyTo });

	if (result?.error) {
		log(`Resend error: ${safeJson(result.error)}`);
		process.exit(1);
	}

	log(`Sent ok id=${result?.data?.id || "unknown"}`);
}

main().catch((e) => {
	log(`Unhandled: ${e?.stack || e}`);
	process.exit(1);
});
