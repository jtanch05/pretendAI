# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues in `jtanch05/pretendAI`. Use the `gh` CLI with `-R jtanch05/pretendAI` for all operations because this checkout has no Git remote configured.

## Conventions

- **Create an issue**: `gh issue create -R jtanch05/pretendAI --title "..." --body "..."`. Use a body file for multi-line bodies.
- **Read an issue**: `gh issue view <number> -R jtanch05/pretendAI --comments`, filtering comments by `jq` and also fetching labels when needed.
- **List issues**: `gh issue list -R jtanch05/pretendAI --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> -R jtanch05/pretendAI --body "..."`
- **Apply or remove labels**: `gh issue edit <number> -R jtanch05/pretendAI --add-label "..."` or `--remove-label "..."`
- **Close an issue**: `gh issue close <number> -R jtanch05/pretendAI --comment "..."`

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `jtanch05/pretendAI`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> -R jtanch05/pretendAI --comments`.
