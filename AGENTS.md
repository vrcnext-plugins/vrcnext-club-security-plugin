# Working on Club Security

Reports who joins your instance against per-club presets. One repository is one plugin: `plugin.json` and `main.ts` at the root, `src/` beside them.
Site page: `plugin-club-security.md` in the docs repository.

## Gate

```bash
npm run check                                                   # tsc, eslint, tests
node ../vrcnext-plugin-system/scripts/check-vrcnext-protocol.mjs .   # VRCNext names, args, selectors
```

`@vrcnext/plugin-api` is a `file:` link to a `vrcnext-plugin-system` checkout beside this one.

## Rules

- **Every commit invalidates `plugin.sig`.** The bridge refuses to install or update an unsigned
  or changed tree. Only the owner signs, locally (`node scripts/sign-plugin.mjs sign --key …`);
  never sign, never add CI signing, and say in your summary that a re-sign is needed.
- The bridge's source policy scans every non-test source file, comments included: no `window`,
  `eval`, bare `fetch`, storage, `.constructor`, imports outside the repository, and the rest on
  the site's Source policy page. Tests are `*.test.ts`, never imported by plugin code.
- Read VRChat data only through `ctx.vrchat`, never by sending `vrcGet…` actions yourself: VRCNext
  would paint its own dialogs for the replies.
- Generic helpers belong in `@vrcnext/plugin-api`, not copied into a plugin.
- Keep `version` in `plugin.json` and `package.json` equal; bump it for every release, since the
  bridge refuses an update to a lower version.

## Every repository

- **Documentation lives only on the site** ([vrcnext-plugins.github.io](https://github.com/vrcnext-plugins/vrcnext-plugins.github.io)).
  This repository keeps a compact `README.md` (name, one line, docs link, one quick-start block,
  licence) and this file, nothing else. When behaviour changes, update the site pages named below
  in the same piece of work.
- Commit messages end with a `Co-Authored-By:` trailer naming the model that wrote the commit.
- **Workflows run only by hand.** Every workflow's only trigger is `workflow_dispatch`; automatic
  triggers (`push`, `pull_request`, tags, schedules) stay commented out. Never run a workflow
  yourself — the owner dispatches them.
- Never drive VRCNext with a synthetic mouse or keyboard, and restart or reload it sparingly —
  both re-authenticate against VRChat. Inspect the page through the bridge's `remote` service
  (`vrcnext-eval '<async body>'`, bridge started with `--dev`).

## Other repositories

Each has its own `AGENTS.md`; read the one for any repository you change. Checkouts sit side by
side, so the local path is a sibling directory.

| Repository | Local | What it is |
| :--- | :--- | :--- |
| [`vrcnext-plugin-system`](https://github.com/vrcnext-plugins/vrcnext-plugin-system/blob/main/AGENTS.md) | `../vrcnext-plugin-system/AGENTS.md` | host, `@vrcnext/plugin-api`, installer, VRCNext protocol tools |
| [`vrcnext-bridge`](https://github.com/vrcnext-plugins/vrcnext-bridge/blob/main/AGENTS.md) | `../vrcnext-bridge/AGENTS.md` | the native daemon: install pipeline, source policy, signing, services |
| [`vrcnext-plugins.github.io`](https://github.com/vrcnext-plugins/vrcnext-plugins.github.io/blob/main/AGENTS.md) | `../vrcnext-plugins.github.io/AGENTS.md` | the documentation site — the only docs |
| [`vrcnext-example-plugin`](https://github.com/vrcnext-plugins/vrcnext-example-plugin/blob/main/AGENTS.md) | `../vrcnext-example-plugin/AGENTS.md` | the template plugin; a submodule of the plugin system |
| [`vrcnext-bio-updater-plugin`](https://github.com/vrcnext-plugins/vrcnext-bio-updater-plugin/blob/main/AGENTS.md) | `../vrcnext-bio-updater-plugin/AGENTS.md` | Bio Updater plugin |
| [`vrcnext-patches-plugin`](https://github.com/vrcnext-plugins/vrcnext-patches-plugin/blob/main/AGENTS.md) | `../vrcnext-patches-plugin/AGENTS.md` | VRCNext Patches plugin |
