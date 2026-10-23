# Setting up a non-technical editor, end to end

For maintainers. Goal: the editor opens the ChatGPT desktop app, picks Codex, and can say "let's change…", "show me", and "publish" with no help. Budget about an hour, with you sitting next to them for Part B.

Codex now lives inside the **ChatGPT desktop app** (pick Codex from the ChatGPT dropdown). It runs on the editor's own computer, has a built-in browser that can show `localhost`, and uses the GitHub CLI (`gh`) to publish. Docs: <https://learn.chatgpt.com/docs/app>.

---

## Part A — Repo owner, on github.com (10 min)

1. **Merge the setup PR** that adds `AGENTS.md`, `docs/editor-*.md`, `docs/design-brief.md`, and `.github/workflows/build-check.yml`. The build check runs on that PR itself, so it's a good first test.
2. **Invite the editor** (Settings → Collaborators → Add people). On a personal repo, a collaborator can push branches and merge PRs.
3. **Protect `main`** (Settings → Rules → Rulesets → New branch ruleset, target the default branch):
   - Require a pull request before merging, with **0** required approvals (so they can merge their own).
   - Require status checks to pass → add **`build`** (from "Build check"). It only shows up after the workflow has run once.
   - Block force pushes. Restrict deletions.
   - Note: this also stops anyone pushing straight to `main`; everyone goes through PRs, which the repo already does.
4. *(Optional)* In Cloudflare, turn on **preview URLs for non-production branches**, so a pushed branch gets a link you can open on a phone.

## Part B — The editor's computer (45 min)

### 1. Accounts
- A **ChatGPT** account (Free works to start; it uses a smaller model with unpublished usage caps; Go is $8/mo, Plus $20/mo if limits get in the way).
- A **GitHub** account; accept the repo invite from email.

### 2. Install the tools
**Mac** (the ChatGPT app download is for Apple Silicon Macs):
- Git: open Terminal, run `xcode-select --install`, click Install.
- Node.js: the **LTS** installer from <https://nodejs.org>.
- GitHub CLI: the macOS `.pkg` installer from <https://cli.github.com>.

**Windows** (PowerShell):
```
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id GitHub.cli -e
```
Then close and reopen PowerShell. If `npm` later fails with "running scripts is disabled", run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

### 3. One-time terminal setup (you type, they watch)
```
gh auth login                 # GitHub.com → HTTPS → Yes (authenticate Git) → Login with a web browser
git config --global user.name  "Natasha …"
git config --global user.email "<their GitHub email or noreply address>"
gh repo clone shershey/nycbalboa ~/Sites/nycbalboa
cd ~/Sites/nycbalboa
npm install
npm run dev                   # open http://localhost:4321, check it loads, then Ctrl+C
```
(On Windows use a path like `$HOME\Sites\nycbalboa`.)

### 4. ChatGPT desktop app
1. Install it from <https://learn.chatgpt.com/docs/app> (Mac) or the Microsoft Store (Windows), and sign in.
2. Pick **Codex** from the ChatGPT dropdown. Add a project and choose the `nycbalboa` folder. Start chats with **Work in: This computer** and leave **Worktree off**.
3. Trust the folder when asked, and keep the permission mode on the recommended **Auto** setting (edits inside the project without asking; asks before anything else). Don't use Full access.

### 5. Personal instructions (only on this computer)
Settings → Personalization → personal instructions (`AGENTS.md`). Paste:

```
# About me
I'm Natasha. I lead design and content for the NYC Balboa website (nycbalboa.com).
I'm a Balboa dancer and teacher, so I know the scene and the audience. I'm not technical.

# How I like to work
- Talk to me like a web designer, not an engineer. No code unless I ask.
- Keep answers short. Show me, don't tell me.
- When I'm unsure, give me 2–3 options to pick from.
- Teach me a little as we go, one sentence at a time.
- If something needs Shawn or my husband, say so and draft the message for me.

# In the nycbalboa project
At the start of every chat, read docs/editor-mode.md and docs/design-brief.md
and follow them for everything we do.
```
Optional: turn on **Enable Codex memories** in the same section.

### 6. Pre-approve routine commands
Save the provided `default.rules` file as `~/.codex/rules/default.rules` (Windows: `%USERPROFILE%\.codex\rules\default.rules`), then restart the app. It allows `git`, `gh pr …`, and `npm install/ci/run` without pop-ups, **blocks** force-pushes, and still asks before `git reset --hard`/`git clean`. Everything else asks as normal.

### 7. A "Preview site" button
Settings → Local environments → this project:
- Setup script: `npm install`
- Add action: name **Preview site**, command `npm run dev`, any icon.

It shows up in the app's top bar. Codex saves this config in the project's `.codex/` folder. Have the editor's first practice change be "publish the new Preview button setup", so it gets committed for everyone.

## Part C — First session together (15 min)
1. New Codex chat in the project → "What instructions are you following?" It should mention her preferences, `editor-mode.md`, and the design brief.
2. Click **Preview site**, then: "Show me the Learn page." It should open in the built-in browser.
3. A small real change ("make the intro on the Learn page friendlier"). Try **Annotate** in the browser toolbar to point at something and ask for a tweak.
4. "Publish." Watch it make the PR, wait for the Build check, merge, and confirm on nycbalboa.com a few minutes later.
5. "Undo that." Confirm it reverts with a new PR.

After that, they should be self-sufficient.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Codex can't push / "permission denied" | `gh auth status`; rerun `gh auth login`; check the repo invite was accepted |
| Merge blocked | Build check failing (ask Codex to fix it) or the ruleset requires approvals (set to 0) |
| Homepage "Upcoming Events" empty in preview | The calendar feed couldn't be reached locally; harmless |
| Preview won't start | `npm install` in the integrated terminal, then Preview site again |
| Lots of approval pop-ups | Rules file not in `~/.codex/rules/`, or the app wasn't restarted |
| Agent isn't in "editor mode" | Personal instructions not saved; ask "what instructions are you following?" |
