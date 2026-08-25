# Annotate & Connect

A Figma plugin for Design files:

- **Annotate** — notes drawn as real canvas nodes. No Dev Mode, no
  View → Annotations toggle, and they show up in exports and presentation mode.
- **Connect** — connectors between layers that stay attached, with adjustable
  stroke weight, colour, dash, and separate head/tail arrow styles.

## Install (development)

Requires Node 22+ and the Figma **desktop app**.

```bash
npm install
npm run build
```

Then: Figma desktop app → Plugins → Development → **Import plugin from
manifest…** → select the generated `manifest.json` in this folder.

While working on it, `npm run watch` rebuilds on save; re-run the plugin in
Figma to pick up changes.

## Known limitation

Figma plugins cannot run in the background. Connectors follow their layers live
while the plugin window is open; if someone moves a layer with the plugin
closed, the line stays put until the next re-sync — which happens automatically
when the plugin is opened, or on demand via **Plugins → Development → Annotate &
Connect → Re-sync this page**.

## Project docs

- `docs/adr/` — architecture decisions
- `docs/spikes.md` — open questions the Figma docs do not answer
- `docs/qa-checklist.md` — manual verification steps
