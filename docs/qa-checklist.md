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
- [ ] Switch a note between Small / Medium / Large → the card, its type, its
      padding and its category pill all resize together, in place
- [ ] Do the same on a note written in **Thai**, and on one made before sizes
      existed → no "Cannot write to node with unloaded font" toast. Any write
      that touches type has to come after the font it is about to use is
      loaded, and an existing node's font is not loaded just because the node
      is there.
- [ ] An annotation made before sizes existed → renders at Medium, unchanged
- [ ] A Large card next to a frame with a narrow gap → shrinks to fit rather
      than bleeding into the neighbouring frame
- [ ] Drag a card's side edge → it stays at the width you left it, the text
      reflows into the wider column, and the type size does not change
- [ ] Drag it *narrower* too, not just wider: the text has to reflow down with
      it rather than propping the card open at its old width — and the card
      must not end up sticking out past the edge of a section it sits beside
- [ ] Drag a card wider than the gap beside its frame → it stays at the width
      you dragged. Shrink-to-fit is for widths the plugin chose, not ones a
      person set with the gap in front of them.
- [ ] A card beside a screen that sits **inside a section**, with another
      screen close by → its automatic width still shrinks to clear that
      neighbour (the measurement looks inside sections and groups).
- [ ] Pick a size after dragging a width → the dragged width is dropped and
      the preset's width applies (this is the way back)
- [ ] No frame name is drawn above an annotation card or a connector's label
      pill on the canvas
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

## Connect — obstacle avoidance

- [ ] Three frames in a row, connector from the first to the third: the line
      goes around the middle frame, not through it.
- [ ] Drag the middle frame out of the way: the line straightens back out.
- [ ] Drag the middle frame back in: the line goes around again, live.
- [ ] Two frames with nothing between them: the route is the same plain bend it
      always was — avoidance must not perturb a clear page.
- [ ] Switch the line style to `STRAIGHT` and to `CURVE`: both ignore obstacles
      and cut straight through, as designed.
- [ ] A connector whose label pill sits between the two frames: the line does
      not swerve around its own label.
- [ ] Endpoints nested inside frames: the line does not try to avoid the frame
      it starts or ends in.
- [ ] Three screens **inside a section**, connector from the first to the
      third: it goes around the middle one, same as on bare canvas. A section
      holds screens rather than being one, so it is looked inside, never
      avoided as a box.
- [ ] Same with the three screens **grouped** instead.
- [ ] A page with ~50 top-level frames: dragging a connected frame still tracks
      without the editor stalling.
- [ ] **Go around** set to `Below` on a line that auto-routed above: it flips
      under, and stays under after the frames move.
- [ ] **Go around** set to a direction that doesn't apply (`Left` on a
      left-to-right line): behaves as `Auto`, no error.
- [ ] **Go around** set on a line with nothing in its way: the route does not
      move — the preference only applies when it actually has to go around.
- [ ] Draw a new connector after setting **Go around**: it starts at `Auto`,
      *not* at the direction just pinned — unlike colour and weight, which are
      inherited.
- [ ] Connect a small layer in the *bottom-left corner* of one screen to
      something far to its right: the line leaves by the nearest edge, it does
      not run the full width of its own screen through the content.
- [ ] Same connector: after leaving, it does not turn back through the screen
      it started in.
- [ ] Connect two whole frames (not nested layers): the exit sides are the ones
      facing each other, exactly as before.

## Cross-cutting

- [ ] ⌘Z right after creating a connector leaves no stray nodes
- [ ] A file with ~200 connectors still drags at an acceptable frame rate
- [ ] No "Running Annotate & Connect" toast left behind after closing
- [ ] Two collaborators in the same file do not fight over the same connector
