# GCodeScribe · Icon-Paket

Die bereitgestellten Iconvarianten sind nach Einsatzzweck geordnet:

| Ordner | Inhalt | Verwendung |
|---|---|---|
| `web/` | SVG-/ICO-Favicon, PNG-Favicons, Touch-Icons, WebP und Manifest | Browser und installierbare Webansicht |
| `png/` | Transparente PNGs von 16 bis 1024 Pixeln | Dokumentation und Rasterdarstellung |
| `vector/` | SVG-Varianten | Skalierbare Darstellung |
| `desktop/` | ICO und ICNS | Windows-/macOS-Iconformate für weitere Paketierungen |

Die Website verwendet die passende SVG-Datei sowie Browser- und Touch-Icons aus dem Paket. Das skalierbare Linux-Icon wird ebenfalls aus `vector/gcodescribe.svg` übernommen. Die README verwendet das bereitgestellte PNG.

**SVG-Unterschied:** `gcodescribe.svg` enthält echte Vektorpfade. `gcodescribe-pixel-perfect.svg` enthält dagegen ein eingebettetes PNG und ist trotz SVG-Endung nicht auflösungsunabhängig. Die Vektorzeichnung ist leicht vereinfacht und daher nicht pixelidentisch mit der PNG-Version.

Das Manifest wird zusammen mit den Web-Icons ausgeliefert. Alle Dateien stammen aus dem für dieses Projekt bereitgestellten Icon-Paket.
