# Werkstatt · Demo-Stiftschrift

[**werkstatt-demo.gcsfont herunterladen**](werkstatt-demo.gcsfont)

Diese eigens für die Dokumentation gezeichnete Monoline-Schrift enthält Klein- und Großbuchstaben, deutsche Umlaute, ß, Ziffern und Satzzeichen. Jedes Zeichen besitzt drei leicht unterschiedliche Varianten mit echten, bearbeitbaren Stiftzügen.

Die Schrift wurde synthetisch erstellt und bildet keine persönliche Handschrift ab. Sie ist als Ausgangspunkt zum Ausprobieren des Editors gedacht; weitere Zeichen und eigene Varianten lassen sich ergänzen.

## Importieren

1. Den Arbeitsbereich **Schrifteditor** öffnen.
2. Zu **Installierte Schriften → Hinzufügen** wechseln und die `.gcsfont`-Datei importieren.
3. Im Editor **Meine Schriften** öffnen und **Werkstatt – Demo** auswählen.
4. Ein Zeichen bearbeiten oder den **Schreibtest** öffnen.

Die Datei ist ein JSON-Dokument im GCodeScribe-Exportformat. Sie enthält Rohpunkte und aufbereitete Stiftzüge, Zeichenvarianten und Schriftmetriken.

Die ursprüngliche Demo-Geometrie steht auch im reproduzierbaren [Fixture-Skript](../../scripts/docs/create_demo.py). Das Skript verlangt ein leeres, ausdrücklich angegebenes Datenverzeichnis und überschreibt keine vorhandenen App-Daten.
