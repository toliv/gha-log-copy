# GitHub Actions Log Copy

Copy GitHub Actions step logs with one click.

This extension adds a copy button to every step header on GitHub Actions job log pages like:

`https://github.com/<owner>/<repo>/actions/runs/<run-id>/job/<job-id>`

## Features

- adds a copy button to each step header
- places the button just to the left of the step duration
- copies only the selected step's log lines
- provides a separate button to copy only error-level lines
- auto-expands collapsed steps before copying
- works in both Chrome and Firefox

## Why this exists

GitHub Actions makes it awkward to copy the output of a single step. For long logs, drag-selecting the right range is slow and error-prone. This extension adds a focused copy action right where you need it.

## How it works

GitHub virtualizes long logs in the page DOM, so copying only the currently rendered nodes would miss off-screen lines. This extension fetches the step-specific log fragment from the `data-log-url` attribute GitHub already places on each `check-step` element. It handles HTML log fragments and plain-text responses according to their content type. If fetching or parsing fails, it leaves the clipboard unchanged and shows a persistent failure indicator; hover over the button for guidance. It never falls back to copying the visible DOM lines.

That endpoint is an internal GitHub UI route, so this is intentionally a pragmatic integration rather than an official GitHub API integration.

## Local development

### Chrome

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select this folder

### Firefox

1. Open `about:debugging`
2. Click `This Firefox`
3. Click `Load Temporary Add-on`
4. Pick `manifest.json` from this folder

## Packaging

Run:

```bash
./package-release.sh
```

This creates a clean ZIP in `dist/` for store submission.

## Privacy

This extension:

- only runs on `github.com`
- only activates on GitHub Actions job log pages
- does not send data to any third-party server
- does not use analytics
- does not store user data
- only writes text to the clipboard after an explicit user click

See `PRIVACY.md` for the full policy text.

## Support

- Homepage: `https://oliverio.dev/projects/github-actions-log-copy/`
- Issues: `https://github.com/toliv/gha-log-copy/issues`

## Current limitations

- relies on GitHub's current Actions DOM structure
- relies on GitHub's internal step log fragment route
- the fetched fragment may itself be incomplete if GitHub truncates it or the step is still running; full retrieval for very large logs still needs validation against a signed-in job

## Tests

Run `node --test tests/content.test.cjs` for fetch, clipboard failure, and large plain-text log regressions.

## License

MIT
