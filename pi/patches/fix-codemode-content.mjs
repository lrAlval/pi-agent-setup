// Local patch for @earendil-works/pi-coding-agent (installed bundle, NOT upstream).
// Guards one REAL unguarded content.some site with the exact crash signature:
//   dist/core/bug-report.js -> response.content.some(...) with no Array check.
// A string content (model quirk, mid-flight shape change) throws
// 'content.some is not a function' there. The wider nondeterministic codemode
// crash (nested local_bash, large output) is tracked in
// repro-codemode-content.mjs + codemode-content-upstream-issue.md.
//
// Re-run after every pi update / reinstall:
//   node pi/patches/fix-codemode-content.mjs
// Idempotent: exits 0 with 'already patched' when the marker is present.
// Fails loud (non-zero + which anchor missed) on version drift.
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent');
let version = process.env.PI_VERSION || '';
if (!version) {
	try { version = readFileSync(join(AGENT_DIR, 'install', 'current-version'), 'utf8').trim(); }
	catch { console.error('MISS [current-version] unreadable'); process.exit(1); }
}
const CORE = join(AGENT_DIR, 'install', 'releases', version, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'core');
const TARGET = join(CORE, 'bug-report.js');
const MARK = 'pi-agent-setup patch v1: guard response.content array';

function replaceOnce(path, text, oldStr, newStr, label) {
	const count = text.split(oldStr).length - 1;
	if (count === 0) {
		if (text.includes(MARK)) return text;
		console.error('MISS [' + label + '] in ' + path);
		process.exitCode = 1;
		return text;
	}
	if (count > 1) {
		console.error('AMBIGUOUS(' + count + ') [' + label + '] in ' + path);
		process.exitCode = 1;
		return text;
	}
	return text.replace(oldStr, newStr);
}

if (!existsSync(TARGET)) { console.error('MISS [target missing] ' + TARGET); process.exit(1); }
let text = readFileSync(TARGET, 'utf8');
if (text.includes(MARK)) {
	console.log('skip ' + TARGET + ': already patched');
} else {
	if (!existsSync(TARGET + '.orig')) copyFileSync(TARGET, TARGET + '.orig');
	text = replaceOnce(TARGET, text,
		'if (response.content.some((block) => block.type === "toolCall")) {',
		'if (Array.isArray(response.content) && response.content.some((block) => block.type === "toolCall")) { /* ' + MARK + ' */',
		'content-some-guard');
	if (!process.exitCode) { writeFileSync(TARGET, text); console.log('patched ' + TARGET); }
	else console.error('NOT WRITTEN: ' + TARGET);
}

// Report-only scan: other unguarded .content.some/.map/.filter in core + codemode.
const roots = [CORE, join(CORE, '..', 'extensions', 'codemode')];
const hits = [];
for (const root of roots) {
	let files = [];
	try { files = readdirSync(root).filter((f) => f.endsWith('.js')); } catch { continue; }
	for (const f of files) {
		const p = join(root, f);
		const src = readFileSync(p, 'utf8');
		const lines = src.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (/content\.(some|map|filter)\(/.test(line) && line.indexOf('Array.isArray') === -1) {
				hits.push(p + ':' + (i + 1) + ': ' + line.trim().slice(0, 120));
			}
		}
	}
}
if (hits.length > 0) {
	console.log('scan: unguarded content array calls (report-only):');
	for (const h of hits) console.log('  ' + h);
} else console.log('scan: no other unguarded content array calls');
