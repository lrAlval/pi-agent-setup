# pi-agent-setup

An opinionated [Pi](https://pi.dev/) setup with curated extensions, skills, agents, and local configuration.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/lrAlval/pi-agent-setup/main/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/lrAlval/pi-agent-setup/main/install.ps1 | iex
```

The installer can be rerun safely. Provider authentication stays local and is never included here.

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

- [`todo-eta`](pi/extensions/todo-eta) - Task tracking with ETA estimates.
- [`herdr-agent-state.ts`](pi/extensions/herdr-agent-state.ts) - Shared agent state helpers.
- [`orca-agent-status.ts`](pi/extensions/orca-agent-status.ts) - Orca agent status integration.
- [`pi-permission-system` config](pi/extensions/pi-permission-system/config.json) - Local configuration for [@gotgenes/pi-permission-system](https://pi.dev/packages/@gotgenes/pi-permission-system).
- [`pi-rtk-optimizer` config](pi/extensions/pi-rtk-optimizer/config.json) - Local configuration for [pi-rtk-optimizer](https://pi.dev/packages/pi-rtk-optimizer).
- `pi-observability-plugin` - Local checkout at `~/dev/pi-observability-plugin`; not bundled, so only available where that checkout exists. Built on [Langfuse](https://github.com/langfuse/langfuse).

## Skills and agents

- `skills/` contains 48 shared skill directories.
- `pi/skills/` contains repo-specific `agent-routing` and `slice-tasks` skills.
- `pi/agents/` contains 25 agent definitions.
- The XIAS design skills are installed from `~/.agents/skills`.

## Layout

- `pi/` - Pi settings, agents, extensions, and scripts copied to `~/.pi/agent/`.
- `skills/` - Shared skills installed to `~/.agents/skills/`.
- `memory/` - Portable memory content; credentials and runtime databases are excluded.
- `install.sh` and `install.ps1` - Bash and PowerShell installers.
