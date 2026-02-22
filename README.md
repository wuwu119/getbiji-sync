# GetBiji Sync

Sync your [Get笔记](https://getbiji.com) notes into Obsidian as Markdown files.

## Features

- **One-way sync**: Get笔记 → Obsidian vault (read-only, non-destructive)
- **Incremental sync**: Only fetches new notes since last sync
- **Auto sync**: Configurable interval (5 min to 2 hours)
- **Rich frontmatter**: biji_id, title, tags, note_type, source_url, timestamps
- **Link note expansion**: Automatically fetches original content for link-type notes
- **Cancellable**: Stop sync mid-progress via command palette
- **Deduplication**: Skips notes already in your vault (matched by biji_id)

## Installation

### From Community Plugins (recommended)

1. Open Obsidian Settings → Community plugins → Browse
2. Search for "GetBiji Sync"
3. Click Install, then Enable

### Manual Installation

1. Download `main.js`, `manifest.json` from the [latest release](https://github.com/wuwu119/getbiji-sync/releases/latest)
2. Create folder `<vault>/.obsidian/plugins/getbiji-sync/`
3. Copy the downloaded files into this folder
4. Restart Obsidian and enable the plugin in Settings → Community plugins

## Setup

### Getting Your Refresh Token

1. Open [getbiji.com](https://getbiji.com) in your browser and log in
2. Open Developer Tools (F12)
3. Go to **Application** → **Local Storage** → `www.biji.com`
4. Copy the value of `refresh_token`

### Plugin Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Refresh Token | Your Get笔记 refresh token (stored locally, never sent anywhere except Get笔记 API) | — |
| Target Folder | Vault folder where synced notes are saved | `Get笔记` |
| Auto Sync | Enable automatic sync at regular intervals | Off |
| Sync Interval | Minutes between auto syncs (5, 15, 30, 60, 120) | 30 min |

## Usage

- **Manual sync**: Click the download icon in the ribbon, or run `Sync Get笔记` from the command palette
- **Cancel sync**: Run `Cancel Get笔记 sync` from the command palette
- **Reset sync state**: In settings, click "Reset" to re-fetch all notes on next sync

## Note Format

Each synced note becomes a Markdown file with YAML frontmatter:

```yaml
---
biji_id: "note-id"
title: "Note Title"
note_type: "plain_text"
entry_type: "manual"
tags:
  - "tag1"
  - "tag2"
source_url: "https://..."
origin: "app"
created_at: "2026-01-15T10:30:00Z"
updated_at: "2026-01-15T10:30:00Z"
---

# Note Title

Note content here...
```

## Security

- Your refresh token is stored **locally** in Obsidian's plugin data (`.obsidian/plugins/getbiji-sync/data.json`)
- The token is **only** sent to Get笔记's official API endpoints
- No data is sent to any third-party service
- The token field uses a password input for visual protection

## Support

- [Report issues](https://github.com/wuwu119/getbiji-sync/issues)
- [Source code](https://github.com/wuwu119/getbiji-sync)

## License

[MIT](LICENSE)
