// Verifier for pi/patches/fix-codemode-content.mjs. Exit 0 when the guard is
// present (or the bundle already ships one); non-zero otherwise.
//   node pi/patches/verify-codemode-content.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent');
let version = process.env.PI_VERSION || '';
if (!version) version = readFileSync(join(AGENT_DIR, 'install', 'current-version'), 'utf8').trim();
const TARGET = join(AGENT_DIR, 'install', 'releases', version, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'core', 'bug-report.js');
const MARK = 'pi-agent-setup patch v1: guard response.content array';
if (!existsSync(TARGET)) { console.error('FAIL: bundle file missing: ' + TARGET); process.exit(1); }
const text = readFileSync(TARGET, 'utf8');
const guarded = text.includes('Array.isArray(response.content) && response.content.some');
if (text.includes(MARK) && guarded) { console.log('PASS: codemode-content guard present (' + version + ')'); }
else if (guarded) { console.log('PASS: bundle ships its own guard (' + version + ') - local patch redundant'); }
else { console.error('FAIL: guard missing in ' + TARGET + ' - run fix-codemode-content.mjs'); process.exit(1); }
