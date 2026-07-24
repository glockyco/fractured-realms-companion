# Steam guide: Fractured Realms Data Sheet

Source content and assets for the Steam Community guide that links the public
data spreadsheet. Post it from the game's Community Hub → Guides → Create.

## Form fields

- **Title:** `Fractured Realms: The Complete Data Sheet (Theorycrafter's Foundation)`
- **Branding image:** `assets/fractured-realms-branding-icon-square.webp` (square, 1254×1254; Steam requires a square image ≥195×195)
- **Describe your guide** (browse-list blurb):

  > The Fractured Realms dataset in one spreadsheet: every item, skill action, drop table, the full XP curve, and much more. A base for your own theorycrafting.

- **Categories:** Gameplay Basics, Crafting, Loot, Walkthroughs (optional: Maps or Levels, Weapons)
- **Rights and ownership:** check the "I am the original creator" box.

## Assets

| File | Where it goes |
| --- | --- |
| `assets/fractured-realms-branding-icon-square.webp` | Branding image (the form field above) |
| `assets/fractured-realms-data-sheet-thumbnail.webp` | Hero image at the top of the guide body |
| `assets/fractured-realms-banner-whats-inside.webp` | Header for the "What's in it" section |
| `assets/fractured-realms-banner-open-the-sheet.webp` | Header for the "Get the sheet" section |

Numbers in the body are taken from the compiled model (`model.db`) and match the
published sheet. Re-check them if the dataset changes.

Assets are stored as webp to match the repo convention and keep the tree small.
Steam guide uploads require PNG or JPG, so convert before uploading, e.g.
`dwebp assets/fractured-realms-banner-whats-inside.webp -o whats-inside.png` (or
`magick input.webp output.png`).

## Body (Steam BBCode)

Images are embedded with Steam's `[previewimg=<id>;sizeFull,floatLeft;<filename>]`
tag. The `<id>` is assigned by Steam when you upload each image to the guide, so
it differs per upload; the ids below are from the current published guide.

```
[previewimg=46888913;sizeFull,floatLeft;fractured-realms-data-sheet-thumbnail.jpg][/previewimg]

[i]Every skill, item, enemy, drop, recipe, and XP value in Fractured Realms, extracted from the game into one spreadsheet for theorycrafting.[/i]

[b][url=https://docs.google.com/spreadsheets/d/1RAVsFOqD-AWepQ2OcxjFDorwoZhYaJjewJMx5S_pbjU/edit?usp=sharing]Open the data sheet[/url][/b]

[previewimg=46888912;sizeFull,floatLeft;fractured-realms-banner-whats-inside.jpg][/previewimg]

[h1]What's in it[/h1]
[b]43 tabs, ~9,100 rows[/b], one tab per data table:

[list]
[*][b]548 items[/b] with values, types, and icons
[*][b]412 skill actions[/b] with level reqs, XP, and tick intervals
[*][b]48 enemies[/b] across [b]12 zones[/b], with full drop tables and chances
[*][b]21 skills[/b] and the complete [b]1–99 XP table[/b] (~[b]14.9M XP[/b] per skill for level 99)
[*][b]46 maps[/b], [b]61 tools[/b], [b]21 mastery seals[/b], [b]18 potions[/b], [b]113 achievements[/b]
[*]The full [b]Prestige[/b] system — 14 prestige skills, per-rank XP thresholds, and every bonus
[*]All [b]42 titles[/b] and how they're earned
[*]... and much, much more!
[/list]

[previewimg=46888911;sizeFull,floatLeft;fractured-realms-banner-open-the-sheet.jpg][/previewimg]

[h1]Get the sheet[/h1]
[b][url=https://docs.google.com/spreadsheets/d/1RAVsFOqD-AWepQ2OcxjFDorwoZhYaJjewJMx5S_pbjU/edit?usp=sharing]Open the Fractured Realms Data Sheet[/url][/b]

The [b]Overview[/b] tab has a table of contents and notes the game build the data was generated from.

[h1]Corrections & requests[/h1]
Spot an inaccuracy, or want a table that isn't there yet? Leave a comment.

[b]If this sheet saves you time, a 👍 rating and a ⭐ favorite help other players find it. Thanks![/b]
```
