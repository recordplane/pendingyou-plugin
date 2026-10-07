# Pending You

Pending You is one place for everything your AI agents are waiting on you for. With this plugin, when a decision, a fact or a step is yours, Claude asks in the conversation and on a Pending You card at once, so you can answer wherever you are, from your phone or your desk. The first answer wins, and Claude picks it up and carries on.

## What it adds

- **The Pending You connector**, at https://www.pendingyou.com/mcp. You sign in once in your browser and click Allow. No key or token is stored in the plugin.
- **The `pending-you` skill**: when a decision is yours, and how to ask so you can answer in one tap.
- **The `pending-you-setup` skill**: say “set up Pending You” (or type `/pending-you:pending-you-setup` in Claude Code). It connects, sets up check-ins (a Cowork scheduled task every hour, 7 AM–9 PM), and sends you a test question.
- **Wakes Claude Code when you answer** (Claude Code 2.1.287 or later): a mod that checks the cards a session posted, through its own Pending You connection, and starts a turn when you answer, write back or a fallback comes due, or you hand the session a question from another of your assistants, even while it sits idle. Under the prompt it shows “2 waiting on you”, after the plugin’s name. Allow Pending You’s tools once in `/permissions` (`mcp__plugin_pending-you_pendingyou`) so it can check while you’re away.

## Set it up

- **Claude Cowork:** Customize › Plugins › Add marketplace › Add from a repository: `recordplane/pendingyou-plugin`. Install Pending You, connect its connector (sign in, Allow), and say “set up Pending You” in a Cowork task.
- **Claude Code:** one command in Terminal sets it up, with one approval in your browser: `npx -y pendingyou@latest init`. Then restart Claude Code, and it finishes setting up by itself. It needs Node 20 or later; without it, install the plugin: `claude plugin marketplace add recordplane/pendingyou-plugin`, then `claude plugin install pending-you@pendingyou`. Restart Claude Code, run `/mcp`, choose `plugin:pending-you:pendingyou` and Authenticate, then say “set up Pending You” (or type `/pending-you:pending-you-setup`).

After that, every question Claude leaves you goes in both places: the conversation and Pending You. Answer in either; Claude takes back the other. The same command sets up every coding agent it finds on your computer: Claude Code, Codex (the CLI and the Codex app), OpenCode and Pi, each with its own connection and the one approval. Cursor is set up separately: [its steps are in Help](https://www.pendingyou.com/help#setup-cursor).

## Data

Claude sends Pending You the questions it asks you (a title, a short summary, options and any drafts it attaches) and reads back your answers, through https://www.pendingyou.com. Never passwords, keys or card numbers. Pending You never answers for you. The only model it uses reads a Later time you typed when its own reader can’t, and you see the time before it’s set.

## More

- [Help](https://www.pendingyou.com/help): setting up each app, and what to do when an answer doesn’t arrive.
- [The guide your agents read](https://www.pendingyou.com/docs/skill): when they ask you, and how. This is version 2.40.0.

Generated from Pending You’s guide 2.40.0.
