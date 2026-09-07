# Store Submission Notes

## Product

- Name: `GitHub Actions Log Copy`
- Version: `1.1.0`
- License: `MIT`
- Homepage: `https://oliverio.dev/projects/github-actions-log-copy/`
- Privacy policy: `https://oliverio.dev/privacy/github-actions-log-copy/`
- Support: `https://github.com/toliv/gha-log-copy/issues`
- Source: `https://github.com/toliv/gha-log-copy`

## Short description

`Copy GitHub Actions step logs with one click.`

## Long description

GitHub Actions Log Copy adds a copy button to every step header on GitHub Actions job log pages.

Instead of scrolling and drag-selecting log output, you can click once to copy only the log lines for the step you care about.

Features:

- copy a single step's logs directly from the step header
- place the copy button next to the step duration for fast access
- auto-expand collapsed steps before copying
- handle long logs more reliably by using GitHub's step-specific log fragment when available

The extension only runs on GitHub Actions job pages and does not send copied logs or account data to any third-party service.

## Reviewer notes

This extension only activates on GitHub Actions job log pages with URLs like:

`https://github.com/<owner>/<repo>/actions/runs/<run-id>/job/<job-id>`

To test it:

1. Sign in to GitHub
2. Open a GitHub Actions job log page
3. Confirm that each step header shows a copy icon just to the left of the step duration
4. Click the icon and confirm that only that step's log lines are copied

Notes:

- The extension auto-expands collapsed steps before copying.
- GitHub virtualizes long logs, so the extension may fetch the GitHub-hosted step log fragment referenced by the page's `data-log-url` attribute to copy the full step output.
- No third-party network requests are made.

## Chrome permission justification

- `clipboardWrite`: required to copy the selected step log when the user clicks the button
- `https://github.com/*`: required to inject the copy button on GitHub Actions job pages and fetch GitHub-hosted step log fragments for the selected step

## Required store assets

### Chrome Web Store

- extension icon `128x128`
- at least 1 screenshot, ideally `1280x800`
- small promo tile `440x280`

### Firefox AMO

- extension icon
- screenshots

## Screenshot checklist

Capture at least these screenshots from a real GitHub Actions job page:

1. step header with copy icon visible
2. successful copy state
3. long expanded step log showing the target workflow

Use a clean browser profile and avoid personal repo names or account details unless you are comfortable publishing them.
