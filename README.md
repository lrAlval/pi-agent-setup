# pi-agent-setup

An opinionated [Pi](https://pi.dev/) setup with curated extensions, skills, agents, and local configuration. The installer copies repo files onto live paths deterministically from `manifest.lock`, so reruns converge instead of drifting.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/lrAlval/pi-agent-setup/main/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/lrAlval/pi-agent-setup/main/install.ps1 | iex
```

The installer can be rerun safely. Provider authentication stays local and is never included here.

## Layout

Repo directory → live install target:

| Repo dir | Installs to | Notes |
|---|---|---|
| `extensions/` | `~/.pi/agent/extensions/` | Extension sources and local extension configs |
| `agents/` | `~/.pi/agent/agents/` | Subagent definitions |
| `themes/` | `~/.pi/agent/themes/` | Theme files |
| `config/` | `~/.pi/agent/` | Live Pi settings (`settings.json`, `hide-providers.json`, `models-store.json`, `caveman.json`, `config.yml`, `spark.json`, `subagents-lite.json`, `efficient-pi-ask-user.json`, `AGENTS.md`, `OPINIONS.md`) |
| `scripts/` | `~/.pi/agent/scripts/` | Helper scripts |
| `templates/` | `~/.pi/agent/templates/` | File templates |
| `patches/` | `~/.pi/agent/patches/` | Patch scripts and records |
| `skills/` | `~/.agents/skills/` | Shared skills |
| `skills/<name>/` with a `.pi-target` marker | `~/.pi/agent/skills/<name>/` | Pi-only skills: `agent-routing`, `slice-tasks`, `uix` |
| `memory/` | `~/.pi/agent/pi-hermes-memory/` (`memory/projects/` → `~/.pi/agent/projects-memory/`) | Portable memory content; credentials and runtime databases are excluded |

## Skills

### Public skills

Skills vendored from public sources.

- [`/archify`](skills/archify) - Create validated architecture, workflow, sequence, data-flow, lifecycle/state, ERD, class, tree, timeline, and waterfall diagrams as explorable standalone HTML. (Upstream skill by tt-a1i, MIT.)
- [`/computer-use`](skills/computer-use) - Drive the GUI of a visible local app window through `orca computer`: accessibility tree, clicks, typing, menus, dialogs, and screenshots.
- [`/web-perf`](skills/web-perf) - Audit, diagnose, or optimize website loading and interaction performance, Core Web Vitals, and Lighthouse performance scores.
- [`/mantine-combobox`](skills/mantine-combobox) - Build custom dropdown/select/autocomplete/multiselect components using Mantine's Combobox primitives. (Matt Pocock's public skill collection.)
- [`/mantine-custom-components`](skills/mantine-custom-components) - Build custom components that integrate with Mantine's theming, Styles API, and core features. (Matt Pocock's public skill collection.)
- [`/mantine-form`](skills/mantine-form) - Build forms using @mantine/form. (Matt Pocock's public skill collection.)
- [`/setup-matt-pocock-skills`](skills/setup-matt-pocock-skills) - Set up an `## Agent skills` block in AGENTS.md/CLAUDE.md and `docs/agents/` for the engineering skills.
- [`/setup-ts-deep-modules`](skills/setup-ts-deep-modules) - Wire [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) into a TypeScript repo so each package is a deep module. (Matt Pocock's public skill collection.)
- [`/system-design`](skills/system-design) - Design scalable distributed systems using structured approaches for load balancing, caching, database scaling, and message queues. (Upstream skill by wondelai, MIT.)

### In-house skills

Skills authored here. Entries marked *(pi-only)* carry a `.pi-target` marker and install to `~/.pi/agent/skills/` instead of `~/.agents/skills/`.

- [`/agent-routing`](skills/agent-routing) - Route delegation, worktrees, lanes, dotnet, or token-tool questions to the right granular skill. *(pi-only)*
- [`/ask-matt`](skills/ask-matt) - Ask which skill or flow fits your situation. A router over the skills in this repo.
- [`/brainstorm`](skills/brainstorm) - Shape a new feature or idea before any implementation planning.
- [`/caveman`](skills/caveman) - Ultra-compressed communication mode. Cuts token usage ~75% by dropping filler, articles, and pleasantries while keeping full technical accuracy.
- [`/ccc`](skills/ccc) - Code search, file/directory summary lookup, and concept-guide lookup.
- [`/code-review`](skills/code-review) - Review the changes since a fixed point along two axes: standards compliance and defect risk.
- [`/codebase-design`](skills/codebase-design) - Shared vocabulary for designing deep modules.
- [`/design-taste-frontend`](skills/design-taste-frontend) - Art direction for websites, distilled from a study of 247 curated gallery sites; enforces a no-slop house style with a real-browser inspector.
- [`/diagnose`](skills/diagnose) - DEPRECATED stub - use diagnosing-bugs.
- [`/diagnosing-bugs`](skills/diagnosing-bugs) - Diagnosis loop for hard bugs and performance regressions.
- [`/domain-modeling`](skills/domain-modeling) - Build and sharpen a project's domain model.
- [`/find-docs`](skills/find-docs) - Retrieve up-to-date documentation, API references, and code examples for any developer technology.
- [`/find-skills`](skills/find-skills) - Discover and install agent skills when the user asks how to do something.
- [`/grill-me`](skills/grill-me) - A relentless interview to sharpen a plan or design.
- [`/grill-with-docs`](skills/grill-with-docs) - A relentless interview to sharpen a plan or design, which also creates docs (ADRs and glossary) as we go.
- [`/grilling`](skills/grilling) - Grill the user relentlessly about a plan, decision, or idea.
- [`/handoff`](skills/handoff) - Compact the current conversation into a handoff document for another agent to pick up.
- [`/impeccable`](skills/impeccable) - Design, critique, audit, polish, and harden frontend interfaces.
- [`/impl-lifecycle`](skills/impl-lifecycle) - Route the enforced idea-to-plan lifecycle: brainstorm, then spike only if uncertainty remains, then plan-implementation.
- [`/implement`](skills/implement) - Build a backlog slice per its acceptance criteria with TDD at seams and prove-fix verification.
- [`/implement-spec`](skills/implement-spec) - Implement the result of /to-spec and /to-tickets in code.
- [`/improve-codebase-architecture`](skills/improve-codebase-architecture) - Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick.
- [`/issues`](skills/issues) - Drive GitHub issues through a label-based lifecycle (backlog to done).
- [`/lavish`](skills/lavish) - Turn complex or visual agent responses into rich, reviewable HTML artifacts.
- [`/no-mistakes`](skills/no-mistakes) - Validate code changes through the no-mistakes pipeline: automated review, tests, lint, docs, push, PR, and CI.
- [`/nodejs-backend-patterns`](skills/nodejs-backend-patterns) - Build production-ready Node.js backend services with Express/Fastify.
- [`/orca-cli`](skills/orca-cli) - Operate Orca-managed worktrees, folder contexts, terminals, repos, automations, and artifacts through the `orca` CLI.
- [`/orchestration`](skills/orchestration) - Coordinate supervised Orca workers: threaded messages, task dispatch, task DAGs, and decision gates.
- [`/plan-implementation`](skills/plan-implementation) - Turn a shaped idea into a COMPLETE implementation spec with zero ambiguity.
- [`/plannotator`](skills/plannotator) - Reference for using Plannotator for plan review, code review, and annotating files, URLs, and folders.
- [`/plannotator-annotate`](skills/plannotator-annotate) - Open Plannotator's annotation UI for a file, URL, or folder and then respond.
- [`/plannotator-compound`](skills/plannotator-compound) - Analyze a Plannotator plan archive to extract denial patterns, feedback taxonomy, and prompt improvements.
- [`/plannotator-last`](skills/plannotator-last) - Open Plannotator on the latest rendered assistant message and use the returned annotations to revise it.
- [`/plannotator-review`](skills/plannotator-review) - Open Plannotator's browser-based code review UI and act on the feedback.
- [`/plannotator-setup-goal`](skills/plannotator-setup-goal) - Turn an idea into a goal package for /goal via interviews, a reviewed fact sheet, and codebase exploration.
- [`/plannotator-visual-explainer`](skills/plannotator-visual-explainer) - Generate self-contained HTML visualizations with Plannotator theming.
- [`/ponytail`](skills/ponytail) - Force the laziest solution that actually works: simplest, shortest, most minimal.
- [`/pr`](skills/pr) - Use when writing a PR body.
- [`/pr-review`](skills/pr-review) - Review an open GitHub PR on demand.
- [`/prototype`](skills/prototype) - Build a throwaway prototype to flesh out a design before committing to it.
- [`/research`](skills/research) - Investigate a question against high-trust primary sources and capture the findings as a Markdown file.
- [`/resolving-merge-conflicts`](skills/resolving-merge-conflicts) - Resolve an in-progress git merge/rebase conflict.
- [`/retro`](skills/retro) - Conduct a retrospective on a coding session.
- [`/security-audit`](skills/security-audit) - Security guidance and vulnerability review for codebases, APIs, services, CLI tools, libraries, and daemons.
- [`/simplify-review`](skills/simplify-review) - Run a ponytail simplification pass over new or complex code.
- [`/slice-tasks`](skills/slice-tasks) - Break a goals/<slug>/ package into vertical backlog slices with acceptance criteria. *(pi-only)*
- [`/spike`](skills/spike) - Close a specific technical uncertainty with a scoped throwaway probe.
- [`/tdd`](skills/tdd) - Test-driven development: the red-green-refactor loop with tests worth keeping.
- [`/teach`](skills/teach) - Teach the user a new skill or concept, within this workspace.
- [`/to-issues`](skills/to-issues) - Break a plan, spec, or PRD into independently-grabbable issues on the project issue tracker.
- [`/to-prd`](skills/to-prd) - Turn the current conversation context into a PRD on the project issue tracker.
- [`/to-questionnaire`](skills/to-questionnaire) - Turn a decision you can't fully answer into a questionnaire for someone else to fill in.
- [`/to-spec`](skills/to-spec) - Turn the current conversation into a spec on the project issue tracker.
- [`/to-tickets`](skills/to-tickets) - Break a plan, spec, or conversation into a set of tracer-bullet tickets with blocking edges.
- [`/triage`](skills/triage) - Triage issues through a state machine driven by triage roles.
- [`/uix`](skills/uix) - UI build: design a page, implement an interface, polish UI, fix layout. *(pi-only)*
- [`/vision`](skills/vision) - Draft and stress-test a VISION.md for a repository, then iterate to approval.
- [`/wait-what`](skills/wait-what) - Stop. That last message did not land: re-pitch it.
- [`/wayfinder`](skills/wayfinder) - Plan a huge chunk of work as a shared map of decision tickets on the issue tracker.
- [`/write-a-skill`](skills/write-a-skill) - Create new agent skills with proper structure, progressive disclosure, and bundled resources.
- [`/writing-for-agents`](skills/writing-for-agents) - Write documents for agents: skills, AGENTS.md, or CLAUDE.md.
- [`/zoom-out`](skills/zoom-out) - Zoom out and give broader context or a higher-level perspective.

The XIAS design skills are kit-managed symlinks listed in `skills/xias-symlinks.txt`; they resolve at install time and are never committed here.

## Extensions

### Public packages

- [pi-rtk-optimizer](https://pi.dev/packages/pi-rtk-optimizer) - Optimize tool output; this repo also includes local configuration.
- [@dietrichgebert/ponytail](https://pi.dev/packages/@dietrichgebert/ponytail) - Code-quality review and cost insights.
- [pi-ast-grep](https://pi.dev/packages/pi-ast-grep) - Structural code search.
- [pi-smart-fetch](https://pi.dev/packages/pi-smart-fetch) - Browser-grade web fetching.
- [pi-caveman](https://pi.dev/packages/pi-caveman) - Compact response mode.
- [pi-background-tasks](https://pi.dev/packages/pi-background-tasks) - Background shell commands and agents.
- [@zosmaai/pi-llm-wiki](https://pi.dev/packages/@zosmaai/pi-llm-wiki) - Searchable, linked knowledge base.
- [@plannotator/pi-extension](https://pi.dev/packages/@plannotator/pi-extension) - Annotate and review plans.
- [pi-mcp-adapter](https://pi.dev/packages/pi-mcp-adapter) - Connect to MCP servers.
- [@vigolium/piolium](https://pi.dev/packages/@vigolium/piolium) - Additional Pi tools.
- [pi-hermes-memory](https://pi.dev/packages/pi-hermes-memory) - Persistent user and project memory.
- [pi-observational-memory](https://pi.dev/packages/pi-observational-memory) - Compress and recall session context.
- [@henryqw/pi-codegraph](https://pi.dev/packages/@henryqw/pi-codegraph) - Explore code symbols and call paths.
- [pi-hide-providers](https://pi.dev/packages/pi-hide-providers) - Hide unused model providers.
- [@gotgenes/pi-permission-system](https://pi.dev/packages/@gotgenes/pi-permission-system) - Gate sensitive and destructive operations; this repo also includes local configuration.
- [pi-footer](https://pi.dev/packages/pi-footer) - Show session, model, and cost status.
- [@barlevalon/thermo-nuclear-code-quality-review-skill](https://pi.dev/packages/@barlevalon/thermo-nuclear-code-quality-review-skill) - In-depth code review skill.
- [billion-context](https://pi.dev/packages/billion-context) - Context folding and cache-health tools.
- [pi-subagents](https://pi.dev/packages/pi-subagents) - Delegate work to isolated agents.
- [@juicesharp/rpiv-ask-user-question](https://pi.dev/packages/@juicesharp/rpiv-ask-user-question) - Structured user questions.
- [@tanvesh01/pierre-diffs](https://pi.dev/packages/@tanvesh01/pierre-diffs) - Review code diffs in a visual interface.
- [pi-session-cleanup](https://pi.dev/packages/pi-session-cleanup) - Clean up old sessions.

### Public GitHub packages

- [pi-community-themes](https://github.com/hasit/pi-community-themes) - Community themes for Pi.

### In-house and unpublished

- [`todo-eta`](extensions/todo-eta) - Task tracking with ETA estimates.
- [`agent-hub`](extensions/agent-hub) - Fullscreen read-only task roster (`/hub`).
- [`complexity-nudge`](extensions/complexity-nudge) - Deterministic simplification trigger recommending the `simplify-review` skill above change-size thresholds.
- [`stream-rules`](extensions/stream-rules) - Bounded turn-boundary rule corrections from a JSONL rule file.
- [`herdr-agent-state.ts`](extensions/herdr-agent-state.ts) - Shared agent state helpers.
- [`orca-agent-status.ts`](extensions/orca-agent-status.ts) - Orca agent status integration.
- [`pi-permission-system` config](extensions/pi-permission-system/config.json) - Local configuration for [@gotgenes/pi-permission-system](https://pi.dev/packages/@gotgenes/pi-permission-system).
- [`pi-rtk-optimizer` config](extensions/pi-rtk-optimizer/config.json) - Local configuration for [pi-rtk-optimizer](https://pi.dev/packages/pi-rtk-optimizer).
- `pi-observability-plugin` - Local checkout at `~/dev/pi-observability-plugin`; not bundled, so only available where that checkout exists. Built on [Langfuse](https://github.com/langfuse/langfuse).

## Agents

`agents/` contains 25 subagent definitions installed to `~/.pi/agent/agents/`: codebase locators and analyzers (`codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`, `artifacts-locator`, `artifacts-analyzer`), review and verification agents (`artifact-code-reviewer`, `artifact-coverage-reviewer`, `diff-auditor`, `claim-verifier`, `scope-tracer`, `slice-verifier`, `qa`), research agents (`web-search-researcher`, `bug-detective`, `precedent-locator`, `peer-comparator`, `integration-scanner`, `perf-doctor`, `blast-radius`, `scope-sharpener`), and planning/coordination agents (`foreman`, `scout`, `surveyor`, `sentinel`, `safety-net`, `release-scribe`).

## Themes

`themes/` contains theme files installed to `~/.pi/agent/themes/`, currently `quiet-editorial.json`.

## Support files and utilities

- `config/` - Live Pi settings installed directly to `~/.pi/agent/` (see the layout table).
- `scripts/` - Helper scripts (`session-tool-analyzer.py`, `stack-audit.sh`) installed to `~/.pi/agent/scripts/`.
- `templates/` - File templates (`prp-plan.md`) installed to `~/.pi/agent/templates/`.
- `patches/` - Patch scripts and records installed to `~/.pi/agent/patches/`.
- `memory/` - Portable memory content; credentials and runtime databases are excluded.
- `install.sh` and `install.ps1` - Bash and PowerShell installers.
- `manifest.lock` - SHA-256 of every vendored file; the installers verify against it. Never hand-edit.
- `sync-from-live.sh` + `sync-classify.conf` - Vendor vetted changes from live `~/.pi/agent` back into the repo.

## Install

Same one-liners as above; the installer verifies every file against `manifest.lock`, backs up a pre-existing `~/.pi/agent` once, links kit-managed skills from `skills/xias-symlinks.txt`, and installs vendored package dependencies only when `node_modules` is missing. Reruns are safe and converge.

## Development

```bash
bash -n install.sh && bash -n sync-from-live.sh   # syntax check
bash -c '. ./sync-classify.conf && echo OK'       # classifier loads
```

After changing any vendored file, regenerate the manifest (from the repo root):

```bash
head -n 6 manifest.lock > manifest.lock.tmp && (find extensions agents skills themes config scripts templates patches memory -type f | grep -v 'skills/xias-symlinks.txt' | grep -v '\.pi-target' | sort | xargs sha256sum | sed 's| \./|  |') >> manifest.lock.tmp && mv manifest.lock.tmp manifest.lock
```

The regeneration must produce an empty `git diff` when nothing changed. Never hand-edit `manifest.lock`.
