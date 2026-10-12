// Repro harness for the nondeterministic 'content.some is not a function' crash
// seen with nested local_bash calls carrying large/tricky output.
// RUN VIA THE codemode TOOL (paste this whole file body as the code argument).
// Do NOT run with node: it needs the codemode `tools` global.
const CMDS = [
	'grep -c some /home/aiden/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/codemode-worker.js',
	'grep -n some /home/aiden/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/codemode-worker.js | cut -c1-200',
	'cat /home/aiden/dev/cerberus/pi-agent-setup/install.sh | wc -l',
	'grep -rn the /home/aiden/.agents/skills --include=SKILL.md | head -50',
	'ls /home/aiden/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks | head -40',
	'grep -rn content /home/aiden/.pi/agent/npm/node_modules/pi-rtk-optimizer/src | cut -c1-160 | head -30',
	'cat /home/aiden/dev/cerberus/pi-agent-setup/manifest.lock | head -60',
	'grep -rln content /home/aiden/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/dist | head -10',
];
let crashes = 0;
let oks = 0;
for (let round = 0; round < 2; round++) {
	for (let i = 0; i < CMDS.length; i++) {
		try {
			const r = await tools.local_bash({ command: CMDS[i] });
			oks++;
			console.log('ok r' + round + '#' + i + ' len=' + JSON.stringify(r).length);
		} catch (e) {
			const msg = String((e && e.message) || e);
			if (msg.indexOf('content.some') !== -1) crashes++;
			console.log('ERR r' + round + '#' + i + ' ' + msg.slice(0, 140));
		}
	}
}
return 'done: oks=' + oks + ' content.some crashes=' + crashes + ' total=' + (oks + crashes);
