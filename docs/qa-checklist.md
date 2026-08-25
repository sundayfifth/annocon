# Manual QA checklist

There is no headless test harness for Figma plugins — `src/core/**` is unit
tested, and everything that touches the `figma` global is checked by hand here.
Run against a scratch file in the **desktop app** after `npm run build`.

## Setup

- [ ] `npm run build` succeeds and regenerates `manifest.json`
- [ ] Figma desktop app → Plugins → Development → Import plugin from manifest…
- [ ] Plugin appears under Plugins → Development with both menu commands and a separator

## Annotate

- [ ] Select a frame, type a note → badge and note card appear next to it
- [ ] Drag the frame → badge and leader line follow
- [ ] Edit the note → canvas text updates, no duplicate nodes
- [ ] Delete the note → every rendered node for it is gone, no orphans in the layer panel
- [ ] Select a group or section (no native `annotations`) → still renders, no error
- [ ] Dev Mode / Inspect shows the same annotation (only if spike S1 passed)
- [ ] Export the parent frame as PNG → the annotation is in the image
- [ ] Presentation mode → the annotation is visible

## Connect

- [ ] Select two frames → Connect → a line with an arrow head appears between them
- [ ] Drag one frame far away → the line follows
- [ ] Close the plugin, move a frame, reopen → the line snaps back into place
- [ ] Delete one endpoint frame → the line shows as broken, listed in Broken links, no crash
- [ ] Change weight / colour / head / tail → applies immediately and survives a re-sync
- [ ] Switch line type straight / elbowed / curved → routes sensibly in all four quadrants
- [ ] Select a stale connector → the properties panel shows the Re-sync relaunch button

## Cross-cutting

- [ ] ⌘Z right after creating a connector leaves no stray nodes
- [ ] A file with ~200 connectors still drags at an acceptable frame rate
- [ ] No "Running Annotate & Connect" toast left behind after closing
- [ ] Two collaborators in the same file do not fight over the same connector
