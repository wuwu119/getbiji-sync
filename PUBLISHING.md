# Publishing Checklist

## Pre-submission

- [ ] All tests pass: `npm test`
- [ ] Build succeeds: `npm run build`
- [ ] `manifest.json` id = `getbiji-sync`, version matches
- [ ] `package.json` version matches `manifest.json`
- [ ] `versions.json` has entry for current version
- [ ] README.md describes purpose, installation, setup, usage
- [ ] LICENSE file present (MIT)
- [ ] No credentials/tokens in any committed file
- [ ] Manual test: install plugin from built files, sync works

## Create First Release

```bash
# 1. Ensure clean build
npm install
npm run build

# 2. Tag (NO 'v' prefix — Obsidian convention)
git tag 0.1.0
git push origin 0.1.0

# 3. GitHub Actions will auto-create release with main.js + manifest.json
# 4. Verify release at: https://github.com/wuwu119/getbiji-sync/releases
# 5. Confirm main.js and manifest.json are listed as individual assets
```

## Submit to Community Plugins

1. Fork [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases)
2. Edit `community-plugins.json`, add to end:
   ```json
   {
     "id": "getbiji-sync",
     "name": "GetBiji Sync",
     "author": "wuwu",
     "description": "Sync Get笔记 (biji.com) notes to your Obsidian vault",
     "repo": "wuwu119/getbiji-sync"
   }
   ```
3. Submit PR — automated validation runs
4. Wait for reviewer assignment and approval

## Post-approval

- [ ] Announce on [Obsidian Forum — Share & Showcase](https://forum.obsidian.md/c/share-showcase/)
- [ ] Test installation from Community Plugins browser

## Future Releases

```bash
# Bump version (updates manifest.json + versions.json automatically)
npm version patch  # or minor, major

# Push tag
git push origin --tags

# GitHub Actions handles the rest
```
