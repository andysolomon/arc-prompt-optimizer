# Arc Prompt Optimizer

Most people write prompts like they are texting a friend. Then they wonder why a 200-billion parameter model gives mediocre answers. Prompt engineering is not about tricks. It is about understanding that every token you send is an instruction, and the model follows instructions literally. Write better instructions, get better outputs. It is that simple and that hard.

## Releases

Releases run automatically from `main` with semantic-release. Use Conventional Commits so changes can be versioned correctly:

- `fix:` creates a patch release.
- `feat:` creates a minor release.
- `feat!:` or a `BREAKING CHANGE:` footer creates a major release.

The initial version is `0.1.0`. The GitHub Actions release workflow updates the package version and changelog, creates a GitHub release, and does not publish to npm. Preview a release locally with:

```sh
npm ci
npm run release -- --dry-run --no-ci
```
