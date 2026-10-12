# YT Mini Player for Zen

A [Sine](https://github.com/CosmoCreeper/Sine) mod that adds 🔍 **Search** and ☰ **Queue** buttons to Zen Browser's own media card, the player at the bottom of the sidebar. Click one and the card grows upward to show YouTube search results or your queue right inside it.

```
┌─ Zen media card ────────────┐
│ [Search] [Queue 3]          │
│ 🔍 nujabes                  │
│ Modal Soul        ⤴  +      │
│ Aruarian Dance    ⤴  +      │
│─────────────────────────────│
│ Aruarian Dance · Nujabes    │
│ 1:23 ━━━━●────── 4:06       │
│ ♪  ⏮  ⏯  ⏭  🔊  🔍  ☰       │
└─────────────────────────────┘
```

**Requires the [YT Mini Player](https://github.com/hfzizz/YTPlayer) extension.** It does the searching, the queue and the playback; this mod only puts its panel inside Zen's card.

## Install

1. Install the YT Mini Player extension: get the `.xpi` from [its Releases](https://github.com/hfzizz/YTPlayer/releases) and open it in Zen.
2. Install [Sine](https://github.com/CosmoCreeper/Sine/releases) and restart Zen.
3. In Zen's Settings → **Sine**, turn on installing **JavaScript mods from unofficial sources**.
4. In Sine, add a mod by repository and type: `hfzizz/zen-ytmini`
5. Restart Zen.

If you installed the older copy from `hfzizz/YTPlayer` (folder `zen-mod`), remove it in Sine first.

### Manual install (fx-autoconfig)

1. Set up [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig) for your Zen profile.
2. Copy `ytmini-zen.uc.js` into `<profile>/chrome/JS/`. You don't need the CSS, because the script loads its own styles.
3. In `about:support`, click **Clear startup cache…**, then restart Zen.

## Using it

Play something on YouTube, then switch to another tab. Zen only shows its media card while the playing tab isn't the one you're looking at. The card now has 🔍 and ☰ next to the volume button.

## Troubleshooting

Open the **Browser Console** (Ctrl+Shift+J, or ⌘⇧J on macOS) and type `YT Mini` in the filter box:

| Message | Meaning |
| --- | --- |
| `YT Mini (Zen mod) loaded` | The mod is running. |
| *(nothing at all)* | Sine didn't run the script. Check that JS mods from unofficial sources are enabled, then reinstall the mod and restart. |
| `extension yt-mini-player@hfzizz not found or disabled` | Install or enable the YT Mini Player extension. |
| `could not embed the extension page` | The panel can't be shown inside the card in this Zen version. The buttons then open the player in a tab instead. Please open an issue with the full error. |

## How it works

`ytmini-zen.uc.js` adds the buttons to Zen's `#zen-media-card-template`, so every new card gets them. Clicking one embeds the extension's page `src/zen/panel.html` in the card. It uses a remote extension `<browser>`, set up the same way Firefox sets up extension popups. The script also keeps one hidden copy of that page loaded, which tells the extension the mod is active so it can hide its own floating player.
