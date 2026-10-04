# Pending You for Claude

The Pending You plugin for Claude Cowork and Claude Code. Pending You is one place for everything your AI agents are waiting on you for.

## Install

- **Claude Cowork and claude.ai:** Customize › Plugins › Add marketplace › Add from a repository: `recordplane/pendingyou-plugin`. Install Pending You, connect its connector, and say “set up Pending You” in a Cowork task.
- **Claude Code:** one command in Terminal sets it up, with one approval in your browser: `npx -y pendingyou@latest init`. Then restart Claude Code, and it finishes setting up by itself. It needs Node; without it, install the plugin: `claude plugin marketplace add recordplane/pendingyou-plugin`, then `claude plugin install pending-you@pendingyou`. Restart Claude Code and say “set up Pending You” (or type `/pending-you:pending-you-setup`).

The plugin is in [plugins/pending-you](plugins/pending-you). This repository is generated from recordplane/pendingyou; send changes there.
