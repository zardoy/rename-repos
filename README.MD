# Owner-name repos

Advanced utility for managing names of your cloned repos from GitHub and possible more.

## Philosophy

By default, `git clone` and even `gh repo clone` chooses the name for the directory just *repo name*, but if you need to clone (for some reason) forks of different people.
And yes, I still prefer to clone every repo locally rather than work with them [remotely](https://docs.github.com/en/codespaces/developing-in-codespaces/using-codespaces-in-visual-studio-code).

## What is does?

## TODO

- [ ] Publish to NPM. For now you can clone repo and run `local-test` NPM script
- [ ] Testing

> Note: I don't really maintain this utility, but it's alive

This is the most comprehensive CLI to:

- Rename repos to `owner_repo-name` template. Ex: `vscode-eslint` into `microsoft_vscode-eslint`.<!--  or other template (`--template YOUR_TEMPLATE`) -->

![demo](media/rename-demo.png)
