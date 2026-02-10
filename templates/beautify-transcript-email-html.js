/**
 * Beautify a Cursor transcript (raw text) into HTML suitable for email.
 * - Handles "user:" / "assistant:" turns
 * - Renders <user_query> blocks
 * - Renders <code_selection ...> blocks with header + line numbers
 * - Collapses <attached_files> placeholder
 * - Escapes HTML, preserves spacing, wraps long code lines
 *
 * Usage:
 *   const html = beautifyTranscriptToEmailHTML(transcriptText, { title: "Cursor Agent Result" });
 */

const css = `
  :root{color-scheme:light}
  body{margin:0;padding:0;background:#ffffff;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial}
  .wrap{max-width:900px;margin:0 auto;padding:24px}
  .card{border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#fff}
  .card + .card{margin-top:18px}
  .hdr{padding:16px 18px;border-bottom:1px solid #e5e7eb;background:#f9fafb}
  .hdr h1{margin:0;font-size:16px;line-height:1.3;font-weight:700;color:#111827}
  .hdr .meta{margin-top:6px;font-size:12px;color:#6b7280}
  .turn{padding:16px 18px;border-top:1px solid #f3f4f6}
  .turn:first-child{border-top:none}
  .role{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:4px 8px;border-radius:999px}
  .role.user{background:#eff6ff;color:#1d4ed8}
  .role.assistant{background:#ecfdf5;color:#047857}
  .content{margin-top:10px;font-size:13px;line-height:1.55;color:#111827}
  .p{margin:10px 0}
  .muted{color:#6b7280}
  .box{border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;padding:12px;margin:12px 0}
  .qtitle{font-size:12px;font-weight:700;color:#111827;margin:0 0 8px 0}
  .codehdr{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
  .badge{font-size:11px;background:#f3f4f6;color:#111827;border:1px solid #e5e7eb;border-radius:999px;padding:3px 8px}
  pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;line-height:1.5;color:#0f172a}
  .lines{counter-reset:ln}
  .ln{display:block}
  .ln:before{counter-increment:ln;content:counter(ln);display:inline-block;width:2.7em;margin-right:12px;text-align:right;color:#94a3b8}
  .raw{margin-top:18px;border-top:1px dashed #e5e7eb;padding-top:14px}
  .raw h2{margin:0 0 8px 0;font-size:12px;color:#6b7280;font-weight:700}
`.trim();

const esc = (s) =>
	String(s)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

const safeJson = (obj) => {
	try {
		return JSON.stringify(obj, null, 2);
	} catch {
		return String(obj);
	}
};

const normalizeNewlines = (text) => String(text ?? "").replace(/\r\n/g, "\n");

const splitTurns = (src) => {
	const turns = [];
	const re = /^(user|assistant):[ \t]*$/gim;
	let lastIndex = 0;
	let m;
	let currentRole = null;

	while ((m = re.exec(src)) !== null) {
		const role = m[1].toLowerCase();
		const markerStart = m.index;
		if (currentRole !== null) {
			const chunk = src.slice(lastIndex, markerStart).trim();
			turns.push({ role: currentRole, text: chunk });
		}
		currentRole = role;
		lastIndex = re.lastIndex;
	}
	if (currentRole !== null) {
		turns.push({ role: currentRole, text: src.slice(lastIndex).trim() });
	} else {
		turns.push({ role: "assistant", text: src.trim() });
	}

	return turns;
};

const renderInlineBlocks = (text) => {
	let t = String(text ?? "");

	// Replace <attached_files> placeholder
	t = t.replace(/<attached_files>\s*<\/attached_files>|<attached_files>\s*/gi, "\n[attached_files]\n");

	// Extract <user_query> blocks
	const uq = [];
	t = t.replace(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/gi, (_, inner) => {
		uq.push(inner.trim());
		return "\n{{{__USER_QUERY__}}}\n";
	});

	// Extract <code_selection ...> blocks
	const codeSelections = [];
	t = t.replace(
		/<code_selection\b([^>]*)>\s*([\s\S]*?)\s*<\/code_selection>/gi,
		(_, attrs, inner) => {
			const pathMatch = attrs.match(/\bpath="([^"]+)"/i);
			const linesMatch = attrs.match(/\blines="([^"]+)"/i);
			codeSelections.push({
				path: pathMatch ? pathMatch[1] : "",
				lines: linesMatch ? linesMatch[1] : "",
				code: inner.replace(/\s+$/g, ""),
			});
			return "\n{{{__CODE_SELECTION__}}}\n";
		}
	);

	// Escape everything, then re-inject safe HTML blocks.
	const parts = esc(t).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

	const blocks = [];
	let uqIdx = 0;
	let csIdx = 0;

	for (const p of parts) {
		if (p.includes("{{{__USER_QUERY__}}}")) {
			const q = uq[uqIdx++] ?? "";
			blocks.push(`
		<div class="box">
		  <div class="qtitle">User query</div>
		  <div class="content"><pre>${esc(q)}</pre></div>
		</div>
	  `.trim());
			continue;
		}
		if (p.includes("{{{__CODE_SELECTION__}}}")) {
			const cs = codeSelections[csIdx++] ?? { path: "", lines: "", code: "" };

			// Parse line-numbered code like "100| ..."
			const rawLines = String(cs.code ?? "").split("\n");
			const normalized = rawLines
				.map((ln) => ln.replace(/^\s*\d+\|\s?/, ""))
				.join("\n")
				.trimEnd();

			blocks.push(`
		<div class="box">
		  <div class="codehdr">
			${cs.path ? `<span class="badge">${esc(cs.path)}</span>` : ""}
			${cs.lines ? `<span class="badge">lines ${esc(cs.lines)}</span>` : ""}
		  </div>
		  <pre class="lines">${esc(normalized)
					.split("\n")
					.map((line) => `<span class="ln">${line || " "}</span>`)
					.join("\n")}</pre>
		</div>
	  `.trim());
			continue;
		}

		blocks.push(`<div class="p"><pre>${p}</pre></div>`);
	}

	return blocks.join("\n");
};

const renderTurns = (transcript) => {
	const src = normalizeNewlines(transcript);
	const turns = splitTurns(src);

	return turns
		.filter((t) => t.text && t.text.length)
		.map((t) => {
			const roleClass = t.role === "user" ? "user" : "assistant";
			return `
		  <div class="turn">
			<span class="role ${roleClass}">${esc(t.role)}</span>
			<div class="content">
			  ${renderInlineBlocks(t.text)}
			</div>
		  </div>
		`.trim();
		})
		.join("\n");
};

const renderCard = ({ title, metaLines = [], bodyHtml }) => {
	const meta = metaLines
		.filter(Boolean)
		.map((line) => `<div class="meta">${esc(line)}</div>`)
		.join("");

	return `
	  <div class="card">
		<div class="hdr">
		  <h1>${esc(title)}</h1>
		  ${meta}
		</div>
		${bodyHtml}
	  </div>
	`.trim();
};

const renderDocument = ({ cardsHtml, rawFallback = "" }) => `
  <!doctype html>
  <html>
	<head>
	  <meta charset="utf-8" />
	  <meta name="viewport" content="width=device-width,initial-scale=1" />
	  <style>${css}</style>
	</head>
	<body>
	  <div class="wrap">
		${cardsHtml}
		${rawFallback}
	  </div>
	</body>
  </html>
`.trim();

export function extractLatestResponseFromPayload(payload, rawFallback = "") {
	const candidates = [
		payload?.text,
		payload?.finalResponse,
		payload?.response,
		payload?.message,
		payload?.summary,
		payload?.output,
	];

	for (const c of candidates) {
		if (!c) continue;
		if (typeof c === "string") return c;
		return safeJson(c);
	}

	return rawFallback || "";
}

export function getTranscriptPathFromPayload(payload) {
	return payload?.transcript_path || payload?.transcriptPath || "";
}

export function beautifyTranscriptToEmailHTML(
	transcript,
	{
		title = "Agent transcript",
		includeRawFallback = true,
		maxRawFallbackChars = 15000,
	} = {}
) {
	const src = normalizeNewlines(transcript);
	const renderedTurns = renderTurns(src);

	const card = renderCard({
		title,
		metaLines: [new Date().toISOString()],
		bodyHtml:
			renderedTurns ||
			`<div class="turn"><div class="content muted">No transcript content.</div></div>`,
	});

	const rawFallback =
		includeRawFallback && src
			? `
		  <div class="raw">
			<h2>Raw transcript (truncated)</h2>
			<pre>${esc(src.slice(0, maxRawFallbackChars))}${
				src.length > maxRawFallbackChars ? "\n...(truncated)" : ""
			}</pre>
		  </div>
		`.trim()
			: "";

	return renderDocument({ cardsHtml: card, rawFallback });
}

export function beautifyPayloadToEmailHTML(
	payload,
	{
		title = "Cursor agent finished",
		includeRawFallback = true,
		maxRawFallbackChars = 15000,
		transcriptText = "",
		latestResponse,
		transcriptPath,
	} = {}
) {
	const responseText = latestResponse ?? extractLatestResponseFromPayload(payload);
	const fullTranscript = transcriptText ?? payload?.transcript ?? "";
	const path = transcriptPath ?? getTranscriptPathFromPayload(payload);
	const now = new Date().toISOString();

	const responseTurns = renderTurns(`assistant:\n${responseText || ""}`);
	const responseCard = renderCard({
		title: "Latest response",
		metaLines: [now],
		bodyHtml:
			responseTurns ||
			`<div class="turn"><div class="content muted">No latest response.</div></div>`,
	});

	const transcriptTurns = renderTurns(fullTranscript);
	const transcriptCard = renderCard({
		title: title || "Full transcript",
		metaLines: [now, path ? `Transcript path: ${path}` : "Transcript path: (missing)"],
		bodyHtml:
			transcriptTurns ||
			`<div class="turn"><div class="content muted">No transcript content.</div></div>`,
	});

	const rawFallback =
		includeRawFallback && fullTranscript
			? `
		  <div class="raw">
			<h2>Raw transcript (truncated)</h2>
			<pre>${esc(fullTranscript.slice(0, maxRawFallbackChars))}${
				fullTranscript.length > maxRawFallbackChars ? "\n...(truncated)" : ""
			}</pre>
		  </div>
		`.trim()
			: "";

	return renderDocument({ cardsHtml: [responseCard, transcriptCard].join("\n"), rawFallback });
}
