# git started

`git started` is a mobile-first Git practice application for beginners. Students
can follow a short lesson, connect a GitHub repository, load its text files, edit
them in the browser, and push a real commit to the repository's default branch.

## What is included

- Responsive mobile terminal interface
- Guided command cards for `git status`, `git add .`, `git commit`, and `git log`
- Interactive simulated command history with `help` and `clear`
- GitHub repository URL and token connection
- Real repository tree and text-file loading
- In-browser file editing and Git Data API commits
- Progress indicator for the first-commit lesson
- Light/dark theme toggle

The terminal lesson remains a guided simulation, while repository loading and
committing use GitHub's REST API. The pasted fine-grained token is held only in
component memory and is not persisted. Use a token with repository Contents
read/write permission, and only connect repositories you are authorized to
modify.

## Run locally

```bash
npm install
npm run dev
```

Build and quality checks:

```bash
npm run build
npm run lint
```
