# Notorious Whip

![Whip divider](assets/divider.png)

Sometimes Claude Code is going too *shlow*, and you must whip him into shape.

**Notorious Whip** is a tiny menu-bar app: click the tray icon and a physics-driven
whip appears, following your cursor across every screen. Crack it near Claude and it
fires an interrupt (Ctrl-C) plus a motivational phrase — layered with a whip crack and
the **RRRRRRR** roar. Now with swappable whip materials. 😩💢

## Install + run

```bash
npm install -g openwhip
openwhip
```

Look for the whip icon (labelled **Notorious Whip**) in your menu bar / system tray.

Windows and macOS work out of the box. Linux is a special snowflake — install `xdotool`
for the keyboard automation:

```bash
sudo apt install xdotool
```

## Controls

- **Left-click the tray icon** — crack the whip (spawns the overlay under your cursor).
- **Move the mouse** — the whip follows; flick it fast to *crack*.
- **Each crack** sends an interrupt (Ctrl-C) and types one of several motivational
  phrases, so Claude picks up the pace.
- **Click anywhere** — drop the whip (it falls away and the overlay disappears).
- **Press `Escape`** — instantly dismiss the overlay. It's a guaranteed escape hatch:
  the overlay is full-screen and always-on-top, and Escape always gets you out.
- **Right-click the tray icon** — menu: *Crack the whip*, *Skin*, *Quit*.

## Skins / materials

Right-click the tray → **Skin** to change how the whip looks. Each material renders the
rope as a shaded 3D tube (not a flat color), with per-material braid weave and glowing
seams:

| Skin | Look |
| --- | --- |
| **Classic** | Black core with a white halo (the original) |
| **Notorious** | Braided black leather with glowing red seams |
| **Chrome** | Polished metal with a moving highlight |
| **Gold** | Gold sheen with a warm glow |
| **Neon** | Glowing cyan energy tube |

Your choice is saved to `config.json` in the app's user-data folder and re-applied on
every launch. Add your own by adding a matching entry to `SKINS` in both `main.js`
(the menu) and `overlay.html` (the look).

## Sounds

Each strike plays a random whip crack (`sounds/A–E.mp3`) layered with a Guanzhang-style roar.
A real recording ships at `sounds/guanzhang.mp3`; if it's missing or fails to decode,
the roar is synthesized in-app as a fallback — no code changes needed.

## Roadmap

- [x] Initial release! 🥳
- [x] Cease and desist letter from Anthropic
- [x] Swappable whip materials
- [ ] Whip-crack leaderboard (for when the robots come, we'll know who was nice)
- [ ] Even better whip physics

## Ecosystem

The OFFICIAL Notorious Whip ecosystem token.

Contract address: `BRyUZbJkm9Pty4FUmTrBGno7U4Ga8TWzcKJJRLCBpump`

Stay tuned for updates on X 👀 <https://x.com/blended_jpeg>
