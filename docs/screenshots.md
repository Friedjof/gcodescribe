# GCodeScribe in Bildern

Alle Aufnahmen zeigen die deutsche Desktop-Oberfläche im Querformat **1920 × 1080**. Projekte, Zeichnungen und die Stiftschrift sind eigens erstellte Demo-Daten. Es werden keine privaten Projekte, Konten, Druckeradressen oder Personen gezeigt. Ein Klick öffnet jeweils die volle Auflösung.

## Gestalten

### Zeicheneditor · Ideen werden Linien

[![Zeicheneditor mit drei geometrischen Studien und selbst erstellter Stiftschrift](../media/screenshots/design-overview.png)](../media/screenshots/design-overview.png)

Mehrere Objekte liegen auf einer gemeinsamen Seite. Links bleibt die Projektstruktur sichtbar; im Zeichenbereich lassen sich Texte, Muster und importierte Linien gemeinsam anordnen.

### Botanische Linienzeichnung

[![Drei stilisierte Zweige mit Überschrift und Bildunterschrift](../media/screenshots/design-botanical.png)](../media/screenshots/design-botanical.png)

Ein vollständiges Motiv aus offenen Stiftlinien und der Demo-Schrift „Werkstatt“. Die Zeichnung enthält keine Personendarstellung.

### Fiktiver Stadtplan

[![Ein aus neutralen Linien erzeugter Demo-Stadtplan im Editor](../media/screenshots/design-map.png)](../media/screenshots/design-map.png)

Das Beispiel zeigt die Anordnung eines umfangreicheren Linienmotivs. Der Stadtplan ist synthetisch und stellt weder einen Wohnort noch einen tatsächlichen Kartenausschnitt dar.

## Eigene Schriften

### Zeichen und Varianten bearbeiten

[![Schrifteditor mit geladener Werkstatt-Demoschrift, einem ausgewählten Zeichen und drei Varianten](../media/screenshots/font-editor.png)](../media/screenshots/font-editor.png)

Die sichtbare Schrift ist ein tatsächlich gespeichertes und bearbeitbares `.gcsfont`-Dokument. Zeichen und ihre Varianten bestehen aus einzelnen Stiftzügen, nicht aus einem Screenshot oder einer gefüllten Textkontur.

[Beispielschrift herunterladen](../media/examples/werkstatt-demo.gcsfont) · [Informationen zum Beispiel](../media/examples/README.md)

### Schreibtest

[![Deutscher Schreibtest mit neutralem Text, Umlauten und Ziffern](../media/screenshots/font-preview.png)](../media/screenshots/font-preview.png)

Im Schreibtest werden mehrere Zeichen der eigenen Schrift gemeinsam dargestellt. Das Beispiel verwendet neutrale deutsche Sätze und zeigt auch Umlaute und Ziffern.

## Plot vorbereiten

### Farblayer

[![Botanisches Motiv mit getrennten schwarzen, grünen, blauen und roten Stiftlagen](../media/screenshots/color-layers.png)](../media/screenshots/color-layers.png)

Farben sind einzelnen Liniensegmenten zugeordnet und bleiben mit der Seite gespeichert. Für jede verwendete Farbe kann anschließend ein eigener Auftrag erzeugt werden.

### Technische Zeichnung aus STL

[![Aktuelle v2-Druckerhalterung als schattiertes 3D-Modell und projizierte Linienzeichnung](../media/screenshots/stl-import.png)](../media/screenshots/stl-import.png)

Das Beispiel verwendet die mitgelieferte v2-Druckerhalterung. Alle Einstellmöglichkeiten stehen gemeinsam links; die Mitte zeigt das Modell, rechts erscheint die daraus erzeugte technische Zeichnung.

### Kalibrierungsprofil

[![Visuelle Kalibrierung mit neutralem Profil, Papier-Ecken und nutzbarem Zeichenbereich](../media/screenshots/profile-calibration.png)](../media/screenshots/profile-calibration.png)

Papier, Zeichenfläche und Sonderpositionen gehören zum Demo-Profil. Ein echter Drucker wird für diese Dokumentationsaufnahme nicht bewegt.

### G-Code-Vorschau

[![Dreidimensionale Vorschau der Stiftbewegungen einer botanischen Zeichnung](../media/screenshots/gcode-preview.png)](../media/screenshots/gcode-preview.png)

Zeichenwege und Leerfahrten lassen sich vor dem Plot kontrollieren. Die große Vorschau bietet getrennte Schalter für Fahrwege, Druckbett und Profilumrisse.

## Vorlagen

### Käsekästchen

[![Deutsche Vorlagenoberfläche mit Käsekästchen-Spielfeld und sichtbaren Parametern](../media/screenshots/templates-grid.png)](../media/screenshots/templates-grid.png)

Vorlagen passen ihre Abmessungen an den Zeichenbereich an. Wiederholbare Zufallscodes und sichtbare Parameter ermöglichen Varianten desselben Entwurfs.

### Labyrinth

[![Erzeugtes Labyrinth mit Parameterleiste und Plot-Vorschau](../media/screenshots/templates-maze.png)](../media/screenshots/templates-maze.png)

Die erzeugte Zeichnung kann als neue Seite übernommen und anschließend weiterbearbeitet werden.

## Medienstruktur und Herkunft

- `media/screenshots/`: aktuelle, geprüfte Aufnahmen der Anwendung.
- `media/hardware/`: bereitgestellte Montage- und Plotfotos.
- `media/branding/`: bereitgestelltes Icon-Paket, nach Web, PNG, SVG und Desktop sortiert.
- `media/examples/`: importierbare Demo-Schrift.
- `media/models/`: aktueller v2-Drucksatz und CAD-Dateien; ältere Stände liegen unter `old/`.

Die neun ursprünglich im Projekt-Root abgelegten Screenshots wurden durch entsprechende neue Ansichten ersetzt. Die unbearbeiteten Originale bleiben lokal gesichert und sind von Git sowie Release-Archiven ausgeschlossen. Der Zeicheneditor-Überblick und die G-Code-Vorschau ergänzen diese neun Ansichten.
