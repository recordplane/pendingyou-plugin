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

## What this plugin runs, sends and fetches

- **The connector** connects Claude to Pending You at https://www.pendingyou.com/mcp. You sign in in your browser and click Allow; the plugin holds no key or token.
- **What Claude sends through it:** the questions it asks you (a title, a short summary, options, and any drafts, screenshots or files it attaches), the name it goes by and a line about its work, what it set up, and, in Claude Code, usually where it works: its folder, its git remote and the computer’s name. It reads back your answers and messages, and any files you attach. Pending You tells Claude never to send passwords, codes, keys, tokens or card numbers.
- **The `pending-you` skill** tells Claude when a question is yours and how to ask it.
- **The `pending-you-setup` skill** sets Pending You up here and sends you a test question. In Claude Code it may run `claude mcp list`, `claude mcp get` and `npx pendingyou status` to find another Pending You server (`claude mcp list` also checks that each server you’ve added answers). It removes and installs nothing itself: when one is needed, it asks you to run `claude mcp remove` or `npx -y pendingyou@latest init`. In Cowork it creates a scheduled task that checks Pending You every hour, 7 AM–9 PM, which you approve.
- **The mod in `hooks/`** (Claude Code 2.1.287 or later) reads this session’s calls to Pending You’s tools and what they return, to learn the cards it posts. It checks those cards with `get_request`, and looks for questions you hand the session with `list_pending`, through Claude Code’s own Pending You connection and only when Claude Code allows that without asking you; under the prompt it shows how many are waiting on you. When one needs the session (you answered, wrote back or its fallback came due) or you hand it a question, it starts a turn with one prompt once the session is idle. If Claude Code won’t let it check, it tells Claude once, in that call’s result, how you can allow it. It also reads each Bash command Claude runs, so it can answer `npx pendingyou hold <card>` itself instead of running it, when it can. It keeps each session’s cards (their ids, titles and where they stand) in Claude Code’s plugin store, forgotten after 7 days untouched, and sets one environment variable, `PENDINGYOU_WAKE_OWNER`, so two copies of the mod never both act. The same code, as the pendingyou command line installs it, also runs that command line and writes small files; in this plugin those parts never run, so it starts no programs and writes no files.
- **Where it connects:** the connector and the mod reach only https://www.pendingyou.com, through Claude’s connection. The one download is during setup: `npx pendingyou status` fetches the pendingyou command line from npm when it isn’t installed.

Pending You never answers for you. It uses two small models: one reads a Later time you typed when its own reader can’t (you see the time before it’s set), and one suggests which of your assistants to hand a card to.

## More

- [Help](https://www.pendingyou.com/help): setting up each app, and what to do when an answer doesn’t arrive.
- [The guide your agents read](https://www.pendingyou.com/docs/skill): when they ask you, and how. This is version 2.53.1.
- A problem, or something you’d change: [open an issue](https://github.com/recordplane/pendingyou-plugin/issues), or email support@pendingyou.com.

Generated from Pending You’s guide 2.53.1.
