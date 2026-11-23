# GCodeScribe icon pack

The supplied icon variants are organised by purpose:

| Directory | Contents | Usage |
|---|---|---|
| `web/` | SVG/ICO favicons, PNG favicons, touch icons, WebP and a manifest | Browsers and the installable web view |
| `png/` | Transparent PNGs from 16 to 1024 pixels | Documentation and raster images |
| `vector/` | SVG variants | Scalable artwork |
| `desktop/` | ICO and ICNS | Windows/macOS icon formats for future packaging |

The website uses the supplied favicon and touch-icon variants. The scalable Linux icon comes from `vector/gcodescribe.svg`. The README uses the supplied PNG.

**SVG variants:** `gcodescribe.svg` contains actual vector paths. `gcodescribe-pixel-perfect.svg` embeds a PNG and is therefore resolution-dependent despite its SVG extension. The vector artwork is slightly simplified and is not pixel-identical to the PNG version.

The manifest is distributed with the web icons. All files come from the icon pack supplied for this project.
