# Art reference

The owner's style reference is a front-facing pixel-art buck (about 61 x 82 pixels): light left edges on the
tines, dark undersides on the beams, white ear insides with a dark outline, cream eye rings, a lavender muzzle
and a cream throat patch.

That image is another artist's work, so it is **not checked in**. To compare against it, save it here as
`art/style-reference.png` (git ignores it). The game's deer are drawn fresh in that style by `deerart.js`;
the palette there was sampled from the reference.

`node tests/gallery.js` writes comparison sheets to `tests/gallery/`:

- `vs-reference.png`: the reference next to generated bucks at the same scale (only when the reference is present; also ignored by git)
- `racks.png`: random bucks by age, labelled with points and gross score
- `split-tines.png`: forked G2s and G3s, split brows, forked beam tips
- `non-typicals.png`, `bodies.png`, `levels-of-detail.png`, `same-buck-by-age.png`
