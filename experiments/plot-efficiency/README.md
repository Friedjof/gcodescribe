# Plot-Effizienz: reproduzierbare Evaluation

Untersuchte Produktionsversion: `f62512b`. Zusammenfassung und priorisierte
Umsetzung: [Evaluation](../../docs/plot-efficiency-evaluation.md).
Keine dieser Dateien wird von der App eingebunden. Keine Drucker-/Netzwerkzugriffe.
Alle Motive sind synthetisch oder stammen aus bestehenden deterministischen
App-Generatoren. Keine privaten Dokumente oder Nutzerdaten.

## Ausführen

Aus dem Repository mit vorhandener Python-Umgebung (einschließlich Shapely) und
Node 22 mit Type-Stripping:

```sh
PYTHONPATH=. .venv/bin/python experiments/plot-efficiency/orientation.py
PYTHONPATH=. .venv/bin/python experiments/plot-efficiency/routing.py
PYTHONPATH=. .venv/bin/python experiments/plot-efficiency/geometry.py
PYTHONPATH=. .venv/bin/python experiments/plot-efficiency/pipeline.py
node --experimental-strip-types experiments/plot-efficiency/styling.mjs
.venv/bin/ruff check experiments/plot-efficiency
```

Die Skripte überschreiben ihre jeweiligen Rohdaten unter `results/`. Für Routing
ist mit `--output /tmp/eigener-ordner` ein anderes Ziel möglich. Laufzeiten sind
lokale Messwerte unter wechselnder Hostlast, keine zugesicherte Performance.
Geometriewerte sind deterministisch; spätere Änderungen am Produktionscode
können die Befunde bewusst verändern.

| Skript / Rohdaten | Fragestellung und Prüfung |
| --- | --- |
| `orientation.py` / `results/orientation.json` | Richtungen für feste Reihenfolge mit Start/Park optimieren; neun kleine Fälle gegen alle Orientierungen, sechs App-Motive; exakte Segmente, unveränderte Eingabe |
| `routing.py` / `results/routing.json` | Greedy/2-opt, KD-Schwelle, Konturstart, Koordinaten, Hindernisse, Raster-Merge und Schraffurknoten; Segment-Invarianten für reine Routenkandidaten, echter Safetycheck im Rand-Repro |
| `geometry.py` / `results/geometry.json` | Tatsächliche Centerline-/Preview-Funktionen auf Qualitätsgegenbeispielen; temporäre Rasterdateien werden entfernt |
| `pipeline.py` / `results/pipeline.json` | 13 G-Code-Fälle, dichte/identische Linien und reale Generatoren, Continuous-Kontrollen, wiederholte Renderings, Modal-F-Ausgabe mit exakt gleicher Bewegungs-/Feedfolge |
| `styling.mjs` / `results/styling.json` | Tatsächliche Designer-Funktionen für Strichelung, Lochfüllung und Punktdarstellung |

## Vergleichsbilder

- [Labyrinth](results/routing-maze.svg): schwarz = Zeichnung, rot gestrichelt =
  Leerfahrt. Links bestehendes Scene-Greedy, rechts bestehendes SVG-2-opt. Gleiche
  Striche nach Merge mit 0,001 mm; Continuous aus, keine Parkfahrt. Kein Vergleich
  mit einer unsortierten Vorlage.
- [Hindernis](results/routing-obstacle.svg): konstruiertes Gegenbeispiel. Links
  Luftlinien-Sortierung mit danach umgeleiteten Fahrten, rechts Auswahl nach
  wirklicher Umweglänge. Die graue Fläche ist das Hindernis, mit 3 mm Freiraum
  bei der Wegplanung. Beide Varianten erhalten alle gezeichneten Segmente.

Geometrisch exakt bedeutet hier unveränderte Mittellinien/Segmente. Es beweist
nicht gleiche Tintenablagerung bei Richtungsänderung, neuem Konturstart oder
Nachzeichnen. Die Richtungs-/Naht-Prototypen gelten nur für frei umkehrbare
Striche ohne Druck-/Feed-/Reihenfolgebindung. Die Qualitätsgegenbeispiele in
`geometry.py` und `styling.mjs` zeigen Fehler, keine akzeptablen Optimierungen.

Das Zeitmodell der App, reine Übertragungsuntergrenzen und reale Plotzeit werden
ausdrücklich getrennt. Die vorhandene
[Stiftbreitenstudie](../pen-width/README.md) untersucht ergänzend Farbflächen,
Dubletten, Vereinfachung und Nachzeichnen gegen Absetzen.
