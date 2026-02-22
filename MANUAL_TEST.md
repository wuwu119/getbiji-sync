# Manual Test Checklist

## 8.3 End-to-end sync test
- [ ] Copy `main.js` and `manifest.json` to vault `.obsidian/plugins/biji-sync/`
- [ ] Enable plugin in Obsidian settings
- [ ] Enter refresh_token in settings
- [ ] Click ribbon icon or run "Sync Get笔记" command
- [ ] Verify notes created in target folder with correct frontmatter (biji_id, title, tags, etc.)

## 8.4 Malformed token test
- [ ] Paste garbage text into refresh token field
- [ ] Restart Obsidian — verify no crash on startup
- [ ] Trigger sync — verify "Invalid refresh token format" Notice appears

## 8.5 Cancel sync test
- [ ] Trigger sync with many notes
- [ ] Run "Cancel Get笔记 sync" command
- [ ] Verify sync stops, cursor is saved, no errors in console
- [ ] Trigger sync again — verify it resumes from where it stopped
