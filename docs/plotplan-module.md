# Plotplan-Modul und Prüfung aller gespeicherten Slides

Stand: 16. November 2026. Umsetzung auf `interface-refactoring`, Referenz für
den bisherigen Renderer: `ca6f2e5`. Hintergrund:
[Evaluation](plot-efficiency-evaluation.md).

## Implementierter Umfang

Der Designer verwendet jetzt `plotter.plotplan` als eigenständiges, seiteneffektfreies
Modul. Es lädt keine Profile, verändert keine Dokumente und bewegt keine Hardware.
Der Aufrufer übergibt einen Slide und dessen Kalibrierung.

```python
from plotter.plotplan import build_scene_plan, encode_plot_plan

plan = build_scene_plan(page, calibration)
gcode = encode_plot_plan(plan)
report = plan.report

# Referenzmodus für Regressionen: gleiche Vorbereitung, bisherige Strichreihenfolge.
control = build_scene_plan(page, calibration, optimize=False)
```

| Baustein | Zuständigkeit |
| --- | --- |
| `plotter/plotplan/source.py` | Bestehende Transformationen, Masken, Druck-/Tempodaten, Merge und explizite Continuous-Einstellung übernehmen |
| `model.py` | Unveränderliche Stiftwege, Attribute, Anfahrten, Parkfahrt, Kalibrierungssnapshot und Bericht; inkonsistente Wege ablehnen |
| `routing.py` | Nur frei umkehrbare Striche sortieren: räumlicher Index, Richtungs-DP, begrenztes 2-opt, vorhandene Konturstartpunkte |
| `scene.py` | Maschinen-mm auf Ausgabepräzision, feste Attributgruppen, echte Fahrwege und Endanker, Kandidatenvergleich, Plan-ID und Cache |
| `encoder.py` | Fertigen Plan in G-Code übersetzen, Druck-/Z-Geschwindigkeitsgrenzen und abschließenden Safetycheck anwenden |
| `plotter/geometry/routing.py` | Wiederverwendbarer Hindernisgraph mit Bettgrenzen, Distanzcache und ausdrücklichem Fehler bei unmöglicher Fahrt |
| `plotter/gcode/scene.py` | Bestehende öffentliche Funktionen erhalten; Jobdatei und Metadaten speichern |

Optimiert werden nur Reihenfolge, Richtung und Startpunkt einer geschlossenen
Kontur. Die gezeichnete Segment-Multimenge, Stiftkontakte und geschützte
Attributfolgen bleiben erhalten. Feste Feed-/Druck-/Quellreihenfolgen werden nicht
umgekehrt oder innerhalb der Gruppe sortiert. Ihr erster Punkt bildet den
Endanker der vorhergehenden freien Gruppe; danach folgt gegebenenfalls die Parkfahrt.

Die Auswahl bewertet echte Hinderniswege. Nach der Rundung auf 0,001 mm wird
nochmals der gesamte Leerweg geprüft. Eine Verbesserung wird nur übernommen,
wenn auch diese tatsächlich ausgegebene Strecke kürzer ist. Gleichstände behalten
den bisherigen Plan. Die Suche hat deterministische Grenzen; ein globales
Optimum wird nicht behauptet.

Ein neuer `TravelPlanner(..., bed_bounds=(w,h))` vermeidet den früheren Umweg
außerhalb des Druckbetts. Er hält den bestehenden Abstand von 3 mm zu Hindernissen
ein; die zusätzliche Prüfung gerundeter Wege erlaubt maximal 0,001 mm numerischen
Abstandsverlust. Nicht erreichbare Endpunkte werden abgelehnt. Der abschließende
Safetycheck prüft den vollständigen G-Code weiterhin. Alte Aufrufer ohne Bettgrenzen
behalten außerhalb des Optimierungsmoduls zunächst das bisherige Verhalten.

Die Plan-ID bindet Dokumentstand, Kalibrierung, Optimierermodus und Modulversion.
Score und 3D-Vorschau liefern sie samt Bericht als `plotPlan`; neue Jobmetadaten
speichern `source.plot_plan_id` und `source.plot_plan_version`. Gleiche Snapshots
verwenden denselben Plan. Nach einer Bearbeitung entsteht ein neuer Plan; der
Job-Endpunkt verlangt derzeit noch keine zuvor in der Vorschau bestätigte Plan-ID.

Ein Cache speichert höchstens acht unveränderliche Pläne mit konservativer
Speicherabschätzung bis insgesamt 48 MiB. Schlüssel sind Hashes; große Quell-JSONs
werden nicht im Cache behalten. Zu große Pläne werden weiterhin vollständig
berechnet und geprüft, aber nicht gespeichert. Dies begrenzt den Cache, nicht den
Gesamtspeicher temporärer Geometrie und paralleler Anfragen. Geometrie-/Profiländerungen
invalidieren den Schlüssel automatisch. Der Encoder prüft jede Ausgabe erneut.

## Korpus und Prüfmethode

Es wurden sämtliche lebenden Slide-Einträge aus drei tatsächlichen Speichern
erfasst, ohne die Anwendungs-Stores mit ihren möglichen Migrationen zu verwenden:

| Speicher | Slides | Status im abschließenden Vergleich |
| --- | ---: | --- |
| Laufender Entwicklungsstand, Redis | 83 | geprüft |
| Lokaler Datei-Fallback | 5 | geprüft |
| Flatpak-Dateispeicher | 9 | geprüft |
| Gesamt | **97** | **94 renderbar, 3 leer** |

74 Löschmarkierungen und neun Migrationskopien wurden inventarisiert und nicht als
zusätzliche lebende Slides gezählt. Es fehlen keine referenzierten Seiten oder
Profile. Die Inhalte umfassen insgesamt 1.715.372 gespeicherte Koordinatenpunkte.
Einträge werden pro Installation geprüft, auch wenn Inhalte ähnlich sein können.

Der Bestand umfasst 5.876 Objekte, darunter Bilder, Text, freie Stiftzüge,
Grundformen, Masken, Sudoku und Karten. Vier Objekte nutzen ausdrücklich
Druckvariation; elf tragen Quellreihenfolge und elf gespeicherte Tempowerte.
Kein gespeicherter Slide hat `continuous=False`, kein verwendetes Profil enthält
Hindernisse. Diese Zweige werden durch gezielte Regressionstests geprüft; der
echte Korpus allein liefert dafür keine Abdeckung.

Zwei Slides enthalten zusammen 252 bereits als geplottet markierte Objekte.
Zusätzlich zum normalen Rest-Plot wurden diese beiden Slides vollständig auf
Kopien gerechnet. Das ergibt **99 Prüffälle**, ohne gespeicherte Plotmarkierungen
zu verändern. Die drei leeren Slides sind ausdrücklich kein erfolgreich
gerendertes Motiv.

Die Vergleichskette:

1. Privat gespeicherte, gehashte Schnappschüsse aller Quellen und Profile anlegen.
2. Den unveränderten bisherigen Renderer aus `ca6f2e5` auf diesen Daten ausführen.
3. Den neuen Referenzmodus auf dieselben Daten anwenden; die vollständige modale
   Bewegungsfolge `(G,X,Y,Z,F)` muss zum bisherigen Renderer passen.
4. Den optimierten Plan ausgeben und dessen **tatsächlich gerundeten G-Code**
   unabhängig auswerten: ungerichtete Zeichen-Segment-Multimenge einschließlich
   Z/Feed, Kontaktzahl, geschützte Reihenfolge und vollständiger Leerweg.
5. Cache leeren und den optimierten Plan unabhängig erneut berechnen. Plan-ID
   und G-Code müssen deterministisch sein. Anschließend Cache-Wiederverwendung
   separat messen.
6. Eingabehashes und Korpusabdeckung kontrollieren. Ein Fehler bei einer Seite
   bricht die Inventarisierung nicht ab, macht aber den Auditlauf fehlgeschlagen.

Kein automatisches Einpassen, kein Auslassen schwieriger Motive, keine
Druckerbewegung. Rohgeometrie und private Quelldateien werden nicht eingecheckt.
Der lokale Bericht liegt unter `data/audits/plotplan/slides.json` (Git-ignoriert).

## Gemessener Nutzen und kritische Einordnung

Der abschließende Vergleich der 94 renderbaren normalen Slides ergibt:

- **81 Slides mit kürzerem Leerweg, 13 unverändert, keiner schlechter.**
- Gesamt **204,057 → 184,763 m**, entsprechend **19,294 m bzw. 9,46 %** weniger.
- Median der relativen Verbesserung pro Slide: **13,77 %**. Dieser Median ist
  nicht mit dem nach Weglänge gewichteten Gesamtergebnis gleichzusetzen.
- Unveränderte gezeichnete Segment-Multimengen, Stiftkontakte und Druck-/Tempofolgen.
- Alle 94 Referenz-Bewegungsfolgen stimmen mit dem vorherigen Renderer überein.

Die beiden zusätzlichen vollständigen Kopien bestehen ebenfalls alle Prüfungen;
deren Leerwege sinken zusammen von 1,748 auf 1,310 m. Diese zusätzlichen Varianten
werden nicht in die obige Gesamtersparnis eingerechnet. Insgesamt sind alle 99
Prüffälle erfasst: 96 erfolgreiche Vergleiche und drei ausdrücklich leere Slides.
Alle 96 Referenz-Bewegungsfolgen entsprechen dem alten Renderer, alle Eingabehashes
bleiben unverändert.

Von den 13 unveränderten Slides sind zwölf vollständig durch Quellreihenfolge
geschützt; einer besteht aus einem einzelnen kontinuierlichen Zug. Es ist richtig,
dort keine künstliche Verbesserung zu erzwingen. Insgesamt werden 18.060 geschützte
Züge erhalten.

**Weniger Leerweg ist noch keine gemessene Zeitersparnis.** Gezeichnete Strecke
und Hubzahl bleiben in dieser ersten produktiven Optimierungsstufe gleich.
Beschleunigung, Firmware und Übertragung beeinflussen die reale Dauer weiterhin.
Die problematische bisherige Zeitschätzung wurde nicht zum Auswahlkriterium gemacht.
Alle Leerweg-Summen verwenden zudem die bisherige Startannahme `(0,0)` pro Job,
die im Bericht als `start_assumed_origin` erscheint. Sie sind keine Messung der
tatsächlichen Kopfposition vor einem Plot. Ein späterer Startpositionsvertrag
muss bekannte Maschinenposition, Planung und Ausführung gemeinsam binden.

**Das Nachzeichnen bleibt der größere offene Zielkonflikt.** 76 Slides enthalten
weiterhin durch Continuous erzeugte Zusatzwege. Im stärksten Fall sind es etwa
21,319 m zusätzliche Zeichenstrecke bei insgesamt 43,636 m und einem Kontakt.
Das neue Modul bewahrt diese bisherige Entscheidung und weist sie aus. Eine
spätere Wahl zwischen einmaligem Zeichnen, Hybrid und Continuous benötigt
Stift-/Tintenbedingungen und ein belastbares Hub-/Zeitmodell.

**Erste Berechnungen sind nicht kostenlos.** Im abschließenden Lauf brauchen
Vorbereitung, Optimierung und Encoding median 1,33 s, im 95. Perzentil 4,03 s,
maximal 7,24 s. Die Route kann zusätzliche Rechenzeit kosten.
Der bereits vorgelagerte Legacy-Greedy-Schritt hat bis 4.000 Striche weiterhin
quadratische Kosten. Daher wird der isolierte KD-Geschwindigkeitsgewinn aus der
Evaluation hier nicht als realisierter Gesamtgewinn behauptet. Der neue Cache
vermeidet erneute vollständige Planung unveränderter Slides; alle 94 normalen
Vergleichsfälle treffen anschließend den Cache. Der erneute Planabruf braucht
median 32 ms, maximal 342 ms einschließlich JSON-Snapshot und Hashbildung;
erneutes Encoding ist darin nicht enthalten. Änderungen müssen weiterhin neu
gerechnet werden. Laufzeiten unter paralleler Testlast sind keine belastbaren
Maschinenvergleiche.

**Keine neue Verschlechterung beweist keine perfekte ursprüngliche Vorlage.**
Die Tests vergleichen mit gespeicherten Linien und bisherigem G-Code. Bereits beim
Import verlorene Details, alte Preview-Reduktion, die Centerline-Konsolidierung,
Strichelungs-/Füllungsfehler oder das vorhandene Raster-Merge werden dadurch nicht
repariert. Diese bleiben eigene Korrekturpakete aus der Evaluation. Ebenfalls
noch nicht Teil dieser Stufe: stiftbreitenabhängiges Löschen, Kontaktreduktion,
neue Füllgeneratoren sowie Umstellung der separaten direkten SVG-/CLI-Emitter.

## Wiederholbare Prüfung

`scripts/snapshot_plot_slides.py` liest ausschließlich Slide-/Indexdaten und
Profilkalibrierungen. Ein Zielverzeichnis muss neu und außerhalb der Quellen sein.
Der Redis-Zugang kommt aus einer Umgebungsvariablen und wird nicht ausgegeben.
Dateiquellen werden doppelt gelesen; Redis verwendet MGET mit Stabilitätsprüfungen.
Bei gleichzeitigen Änderungen wird die Aufnahme verworfen statt Quellen zu verändern.

Beispiel für einen Dateispeicher:

```sh
.venv/bin/python scripts/snapshot_plot_slides.py \
  --file-source local=data --output /tmp/gcodescribe-slides-neu
.venv/bin/python scripts/audit_plot_plans.py \
  --source local=/tmp/gcodescribe-slides-neu/local \
  --include-plotted --output data/audits/plotplan/neuer-lauf.json
```

Redis kann mit `--redis-source development --redis-url-env REDIS_URL
--profiles-from data` aufgenommen werden. Weitere Dateispeicher werden über
wiederholtes `--file-source` ergänzt. Der Audit nimmt entsprechend mehrere
`--source`-Argumente an.

Für den zusätzlichen Vergleich mit einer alten Version wird diese separat
ausgecheckt/exportiert. Zuerst den Audit mit `--baseline-package /pfad/zur/alten/version`
ausführen, danach denselben Quellsnapshot mit `--baseline /pfad/zum/baseline.json`.
Quellmenge und Variantenflags müssen identisch sein. Ein unvollständiger oder
nachträglich veränderter Baseline-Lauf wird abgelehnt.

Gezielte Tests:

```sh
PATH="$PWD/.venv/bin:$PATH" .venv/bin/pytest -q \
  tests/test_plot_plan.py tests/test_plot_plan_routing.py \
  tests/test_travel_bounds.py tests/test_plot_plan_audit.py \
  tests/test_plot_slide_snapshot.py
```

Die Tests enthalten auch Gegenbeispiele, bei denen der Prüfer geänderte Feedwerte,
verlorene Segmente, zusätzliche Kontakte, längeren Leerweg, veränderte Eingaben,
falsche Anfahrten, inkonsistente Snapshots und unvollständige Baselines erkennen
muss. Ergänzend wird die vollständige Backend-Suite ausgeführt.

Abschluss: **1.114 Backend-Tests bestanden**, einschließlich 24 Tests für
Snapshot-/Audit-Infrastruktur; Ruff und `git diff --check` bestanden. Der
99-Fälle-Bericht ist vollständig und deckt exakt die Baseline ab. Ein zusätzlich
ergänzter unabhängiger Kontaktzähler wurde durch einen injizierten Fehlkontakt
getestet; die tatsächlichen Kontakte aller 96 Renderings wurden zusätzlich anhand
der G-Code-Metriken gegen die eingefrorene Baseline geprüft. Dieser nachträgliche
Guard-Test und die Korpusprüfung sind im lokalen Bericht getrennt vermerkt.

Keine Benutzerquelle, Profilkalibrierung oder Plotmarkierung wurde verändert.
Es wurden keine Hardwareplots ausgeführt. Reale Laufzeit, Tintenauftrag und
Materialqualität bleiben deshalb offen.
