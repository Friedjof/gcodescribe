# Planung für stiftabhängige Plotoptimierung

Stand: 16. November 2026. Status: Architektur und Offline-Prototypen; die produktive Plotpipeline ist unverändert. Die Umsetzung erfolgt in einzeln prüfbaren Commits auf `interface-refactoring`.

## Ziel und verbindliche Grenzen

Ein Plot soll bei bekanntem Stift weniger unnötige Zeichenwege, Anhebungen und G-Code-Kommandos benötigen. Maßstab ist die sichtbare Zeichnung auf Papier bei finaler Größe. Eine reduzierte Anzahl von Bildschirm-Linien oder Koordinatenpunkten ist allein kein Erfolgsnachweis.

Drei verschiedene Dinge müssen getrennt behandelt werden:

- **Koordinatenpunkte:** Zwischenpunkte einer Kurve erzeugen Bewegungsbefehle, aber keine separaten Tintenkleckse. Hier helfen kollineare Reduktion und begrenzte Kurvenvereinfachung.
- **Gezeichnete Punkte:** Ein Stiftkontakt an einer Stelle erzeugt eine Fläche. Er kann überflüssig sein, wenn diese bereits eingefärbt wird. Ein freier Satzpunkt bleibt ein eigenständiges Detail.
- **Mehrfachwege:** Identische oder überlappende Wege können redundant sein; beabsichtigte Schattierung, Druckvariation oder wiederholter Farbauftrag können sie aber erforderlich machen.

Die Originalobjekte, Quellpfade und ihre Undo-Historie bleiben editierbar. Optimiert wird ein abgeleiteter Plotplan. Die feine Bearbeitungsansicht zeigt weiterhin alle ursprünglichen Linien. Eine separate Ansicht zeigt das erwartete Plotbild mit physischer Strichbreite und eine weitere Ansicht die tatsächlichen optimierten Wege.

Die erste Version modelliert einen runden Stift mit gleichbleibender Breite und einem Farbauftrag. Keilspitzen, richtungsabhängige Breite, variable Druckschrift, transparente Tinte und gezielte Mehrfachdurchgänge werden erkannt bzw. ausdrücklich als ungeeignet markiert und behalten ihre Wege. Ihre Unterstützung wird erst mit passenden Modellen erweitert.

## Bestandsaufnahme und konkrete Anschlussstellen

| Stelle | Heutiges Verhalten | Konsequenz für die Umsetzung |
| --- | --- | --- |
| `plotter/core/calibration.py` | Maschinenmaße, Z-Höhen und Geschwindigkeiten; `merge_tolerance=0.5` mm; keine reale Strichbreite | Stiftmodell ergänzen, Strichbreite niemals mit Verbindungstoleranz gleichsetzen |
| `plotter/gcode/scene.py` | Transformiert Objekte, verarbeitet Masken/Hindernisse, verbindet und ordnet Linien; eigene Pfade für Quellreihenfolge, Druck und variable Geschwindigkeit | Vor dem Verlust der Objektzuordnung einen attributierten Zwischenstand erzeugen |
| `plotter/geometry/singlepass.py` | Entfernt identische Segmente anhand gleicher Endpunkte; kann Netze ohne Nachzeichnen zerlegen | Basis für eindeutige Wege, aber unterschiedlich unterteilte Überlappungen brauchen zusätzliche Normalisierung |
| `plotter/geometry/oneline.py` | Verbindet Netze durch erneutes Abfahren vorhandener Kanten | Kandidat mit wenig Anhebungen; Nachzeichnen ist eine messbare Kosten- und Farbentscheidung |
| `plotter/geometry/travel.py` | Greedy-Sortierung; große Mengen mit KD-Baum; bei SVG zusätzlich begrenztes 2-opt | Wiederverwenden, Reihenfolgegrenzen und tatsächliche Startposition berücksichtigen |
| `plotter/artwork/drawing.py` | Eigene Platzierung, Skalierung und G-Code-Erzeugung; Teile der Optimierung vor finaler Skalierung | Millimetertoleranzen erst in finalen Papierkoordinaten anwenden |
| `plotter/artwork/pipeline.py` | CLI-Pfad über vpype, eigene Reihenfolge von Vereinfachung/Layout | Gleiche Optionen/Einheiten gewährleisten; keine unbemerkte zweite Optimierung nach dem freigegebenen Plan |
| `plotter/gcode/metrics.py` | Geschätzte Zeit inkl. Beschleunigung, 25 ms Bewegungsaufschlag und 150 ms Z-Beruhigung | Nicht als reale Firmwarezeit ausgeben; Segmentreduktion kann damit überschätzt werden |
| `plotter/web/routes/pages.py` | Vorschau, Bewertung und Plot erzeugen G-Code aus derselben Grundfunktion | Gemeinsamen Plotplan als Schnittstelle einziehen, doppelte Berechnungen vermeiden |
| `plotter/services/profiles.py`, `project_render.py` | Profil-Fingerprint und Kalibrierungssnapshot verhindern veraltete Jobs | Stift-/Optimierungssnapshot zusätzlich binden; Maschinenfingerprint nicht beiläufig migrieren |
| `frontend/.../paint/lib/styling.ts` | Feste Abstände für Schraffur und Punktfüllung; fertige Linien verlieren teilweise ihre semantische Rolle | Generatorrolle und Ursprung erhalten, um Füllungen später gezielt neu erzeugen zu können |

Shapely 2.1.2 ist im bestehenden Lockfile und in der lokalen Umgebung verfügbar. Bei produktiver direkter Nutzung muss es auch eine explizite Projektabhängigkeit mit geprüfter DEB-/Flatpak-Verfügbarkeit werden. Für die Prototypen wurde nichts installiert.

## Was die Demos bereits nachweisen

Ausführung und Bilder: `experiments/pen-width/demo.py`, `results/index.html`, vollständige Zahlen in `results/metrics.json`. Die Eingaben sind synthetisch, deterministisch und in Millimetern. Der Stift wird als Kreisfläche entlang einer Mittellinie modelliert. Alle Werte beziehen sich auf dieses geometrische Modell, nicht auf gemessene Druckqualität.

| Fall | Vorher → nachher | Veränderte Farbfläche | Schlussfolgerung |
| --- | --- | --- | --- |
| Überlappende Linien mit anderer Unterteilung | 76 → 30 mm Zeichenweg; 3 → 1 Kontakt | 0 % fehlend und zusätzlich | Geometrisch exakte Dubletten sind ein guter erster Schritt |
| Überabtastete Kurve, Stift 0,4 mm | 601 → 97 Punkte; 32,431 → 32,430 mm Weg | 0,1645 % fehlt; 0,1625 % hinzugefügt; Randabweichung ca. 0,002 mm | Deutlich weniger Befehle, praktisch gleicher Weg; Zeitersparnis separat prüfen |
| 61 Schraffurlinien, Abstand 0,1 mm, Stift 0,5 mm | 1830 → 930 mm; 61 → 31 Kontakte | 0,0313 % fehlt; ca. 0,02094 mm Randabweichung | Erhebliche Wegersparnis im Modell; Randform begrenzt weitere Ausdünnung |
| Zwei Linien, Abstand 0,12 mm, Stift 0,4 mm | Beide bleiben | 0 % | Löschen einer Linie würde 23,12 % Farbfläche entfernen |
| Vier Punkte auf einer Linie plus freier Satzpunkt | 6 → 2 Kontakte | 0 % | Überdeckte Punkte verschwinden; freier Punkt bleibt |
| Geschützter Schriftpunkt und kleine Schleife | Unverändert | 0 % | Detailsemantik wird nicht durch ein globales Flächenbudget ersetzt |

Zusätzliche Gegenbeispiele:

1. **Mittellinie innerhalb von Tinte reicht nicht:** Die zweite Parallel-Mittellinie liegt innerhalb der ersten Strichfläche. Ihre eigene Strichfläche ragt trotzdem deutlich heraus.
2. **Prozentwerte allein reichen nicht:** Ein einzelner Satzpunkt neben einer großen Zeichnung macht in der Demo nur 0,00626 % der Fläche aus. Ihn zu löschen wäre trotzdem offensichtlich falsch; die Randabweichung beträgt 10 mm.
3. **Kurzer Weg bedeutet nicht unsichtbar:** Eine nur 0,02 mm lange Linie erzeugt im Modell bei 0,4 mm Stiftbreite rund 0,1336 mm² Tinte. Eine pauschale Mindestlänge würde sie falsch entfernen.
4. **Stiftbreite/10 ist keine belastbare Vereinfachungsregel:** Bei 0,04 mm Toleranz sinkt die Kurve auf 23 Punkte, aber etwa 3,08 % Fläche fehlen und 3,04 % kommen hinzu. Erst die strengere Prüfung mit Rücknahme auf 0,002 mm erreicht das gewählte Versuchsbudget.
5. **Grenzen beeinflussen die Ersparnis:** Eine Randtoleranz von 0,020 mm erlaubt bei der Schraffur keine Löschung; 0,025 mm erlaubt etwa jede zweite Linie. Diese Werte sind Versuchseinstellungen und keine physisch validierten Standards.

### Zeitmodell und Zielkonflikt

Die Demo vergleicht die vorhandenen Routenalgorithmen auf demselben Gitter:

| Gitterabstand / Hub | Durchgehend mit Nachzeichnen | Einmal je Strecke | Einordnung |
| --- | --- | --- | --- |
| 0,5 mm / 0,5 mm | 36 mm, 1 Kontakt, App-Schätzung 7,6 s | 30 mm, 8 Kontakte, 11,6 s | Weniger Weg ist hier in beiden Rechenmodellen langsamer |
| 10 mm / 0,5 mm | 720 mm, 1 Kontakt, 31,4 s | 600 mm, 8 Kontakte, 33,1 s | Zweites Modell ohne Segmentstopps bevorzugt dagegen einmaliges Zeichnen: 23,70 statt 24,51 s |
| 10 mm / 5 mm | 720 mm, 1 Kontakt, 32,4 s | 600 mm, 8 Kontakte, 38,3 s | Großer Hub macht Anhebungen teurer |

Bei der Kurve sinkt die App-Schätzung von 29,2 auf 9,0 Sekunden; das zweite Modell liegt vorher/nachher nahezu gleich bei 1,71 Sekunden. Diese Spannweite ist ein Befund zur Modellunsicherheit, kein gemessener Geschwindigkeitsgewinn. Firmware-Lookahead, Beschleunigung, Kurvenwinkel, Übertragung und Z-Mechanik müssen kalibriert werden, bevor die App starke Zeitversprechen macht.

## Stiftmodell und Messablauf

### Datenstruktur

Vorschlag für Version 1: ein optionales, versioniertes `penSetup` neben `calibration` im bestehenden Profil. Keine neue Pflichtbibliothek und keine neue Hauptregisterkarte. Wiederverwendbare Stiftvorlagen können später dieselbe Struktur benutzen.

```ts
type PenSetup = {
  version: 1;
  revision: number;
  name: string;
  nib: 'round' | 'unsupported';
  widthMm: number | null;
  widthLowMm: number | null;
  widthHighMm: number | null;
  source: 'unknown' | 'nominal' | 'measured';
  paperNote: string;
  measurement: null | {
    samplesMm: number[];
    method: 'manual' | 'scan'; // scan später
    capturedAt: string;
    conditions: {
      penDownZ: number;
      drawFeed: number;
      pressureDepth: number;
      directionIndependent: boolean;
    };
  };
};
```

`widthLowMm`/`widthHighMm` sind ein ausdrücklich bestimmter Arbeitsbereich inklusive Messunsicherheit, kein aus wenigen Proben behauptetes statistisches Konfidenzintervall. Messwert, nominelle Breite und nicht bekannte Breite erhalten unterschiedliche sichtbare Zustände. Beispiel 0,4 mm dient nur als Eingabehilfe und darf nicht stillschweigend als gemessen gespeichert werden.

Validator: endliche positive mm-Werte, konsistente Grenzen `low ≤ width ≤ high`, endliche Geschwindigkeiten/Z-Werte, begrenzte Zeichenlängen und Probemengen. UI zunächst 0,05–5 mm als unterstützter Arbeitsbereich; größere/kleinere Werte ausdrücklich außerhalb der getesteten Modellgrenzen behandeln. Keine automatische Umrechnung von Stiftdurchmesser in Strichbreite.

Alte Profile erhalten `penSetup: null`; ihre Maschinenkalibrierung und vorhandenen Fingerprints bleiben gültig. Ein zusätzlicher `penFingerprint` wird aus normalisiertem effektivem Modell und Messbedingungen abgeleitet. Reine Umbenennung darf keinen Job veralten lassen. Änderungen an Breite, Messstatus oder relevanten Bedingungen invalidieren neue stiftoptimierte Pläne.

### Bedienung im vorhandenen Einrichtungsablauf

1. Nach Kontakt- und Abhebehöhe erscheint die kompakte Aufgabe „Strichbreite bestimmen“. Eingabe „Herstellerangabe verwenden“ oder „Mit Testmuster messen“; spätere Messung möglich.
2. Eine kleine Testkarte enthält horizontale, vertikale und diagonale Striche, einen Bogen sowie beschriftete Abstandsreihen. Sie nutzt das aktuelle Papier und das spätere Zeichentempo. Die Auswahl eines Musters bewegt keine Hardware; ein Testplot nutzt die bestehenden Vorschau-/Startbedingungen.
3. Manuell mindestens drei Stellen je Hauptrichtung ablesen; bei sehr feinem Stift Lupe/Messskala verwenden. Die App rechnet mm-Werte zusammen und zeigt die Streuung. Bildschirm-Pixel sind keine Messreferenz.
4. Der Nutzer bestätigt die wirksame Breite und einen konservativen Bereich. Bei stark richtungsabhängigen Ergebnissen bleibt flächenbasierte Entfernung gesperrt; exakte Geometrieoptimierung bleibt verfügbar.
5. Nach Stift-/Papierwechsel oder geänderten Z-/Tempo-Bedingungen erscheint „Breite erneut prüfen“. Der alte Wert bleibt nachvollziehbar, wird aber nicht als aktuell gemessen dargestellt.

Eine spätere Scanmessung braucht ein Maßstabsreferenzfeld, Entzerrung, Hintergrund-/Tintensegmentierung und einen Unsicherheitsbericht. Ein Foto ohne Maßstab liefert keine zuverlässigen Millimeterwerte. Diese Funktion gehört nicht zum ersten Release des Optimierers.

Variable Druckwerte dürfen nicht direkt in Strichbreite umgerechnet werden: Die vorhandenen Xournal-Werte sind relative Steuerwerte. Erst eine echte Messreihe `Breite(Druck, Tempo, Richtung)` würde einen geeigneten Zusammenhang liefern.

## Fachliches Modell der Optimierung

### Gemeinsames Koordinatensystem und Attribute

Alle Prüfungen erfolgen nach endgültiger Skalierung und Objekttransformation in Papier-mm. Stiftbreite skaliert nicht mit dem Objekt. Bei nicht gleichmäßiger Objektverzerrung wird zuerst die Mittellinie transformiert; erst danach wird sie mit der realen kreisförmigen Spitze verbreitert. Sonst würde auch die Spitze fälschlich elliptisch verzerrt.

Ein `PlotStroke` enthält `id`, Objekt-/Quellreferenz, Punkte, explizite Punktmarkierung, Strichrolle (`outline`, `fill`, `text`, `dot`, `unknown`), Stift-/Farbgruppe, Druck-/Geschwindigkeitsdaten, Reihenfolgegruppe, Schutzstatus und Absicht für Mehrfachdurchgänge. Rollen kommen von Generatoren/Importmetadaten; unbekannte Striche werden nicht allein anhand ihrer Länge als Rauschen eingestuft.

Kompatible Gruppen dürfen zusammen optimiert werden. Unterschiedliche Farben, Druckregeln, beabsichtigte Wiederholungen, Maskenebenen und zwingende Reihenfolgen bilden Grenzen. Die aktuelle Reduktion zu nackten Polylinien muss dafür in einen attributerhaltenden Adapter ausgelagert werden.

### Farbfläche und Fehlergrößen

Referenz ist das bestehende Motiv in finaler Größe nach seinen Masken, nicht ein
unbekanntes ideales Originalfoto. Bereits beim Nachzeichnen eines Bildes
verlorene Details lassen sich durch diese Optimierung nicht wiederherstellen.
Die Stiftvorschau muss außerdem vor der Optimierung auf Überstand am Papier bzw.
Maskenrand hinweisen. Ein zu breiter Stift wird nicht automatisch durch
Verkleinern oder Abschneiden des gesamten Motivs kompensiert.

Für eine konstante runde Spitze mit Radius `r = d/2` ist die modellierte Fläche eines Weges die Vereinigung der Kreise entlang seiner Mittellinie. Ein echter Punkt bekommt einen Kreis; ein zufälliges Nullsegment wird nicht automatisch zu einem Punkt umgedeutet. Geometrische Grundlage: [Shapely buffer 2.1.2](https://shapely.readthedocs.io/en/2.1.2/reference/shapely.buffer.html).

Seien `I₀` die ursprüngliche und `I₁` die optimierte Farbfläche:

- Fehlende Tinte: `A− = area(I₀ \ I₁)`.
- Zusätzliche Tinte: `A+ = area(I₁ \ I₀)`.
- Relative Fehler jeweils bezogen auf `area(I₀)`; kleine Bereiche bekommen zusätzlich absolute Grenzen.
- Maximale Randabweichung inklusive innerer Löcher, nicht nur Außenumriss.
- Zahl/Identität geschützter Details, Komponenten, Verbindungen und erhaltener Weißräume.
- Bei späteren Tonwertmodellen zusätzlich Änderung der örtlichen Anzahl von Überfahrten.

Jeder Kandidat wird gegen die ursprüngliche Referenz der Gruppe geprüft. Ein Budget darf nicht mit jedem kleinen Löschschritt neu beginnen. Gelöschte Wege dürfen nicht weiterhin als Abdeckung für spätere Löschungen dienen. Am Ende wird der gesamte Plan erneut geprüft.

Versuchseinstellung für „Ausgewogen“: je höchstens 0,25 % fehlende/zusätzliche Fläche und Randabweichung höchstens `min(0,03 mm, 0,05 × d)`. Dies ist ein Ausgangspunkt für Validierung, keine zugesicherte Unsichtbarkeit. Die gleichen Grenzen gelten auch lokal pro Detailgruppe/Kachel; geschützte Details haben keinen Verlustspielraum. Fenster über Kachelgrenzen überlappen, damit dort keine Fehler verschwinden. Zusammenhängende Löcher/Netzverbindungen werden separat geprüft.

Für „Form exakt“ gelten keine absichtlichen Flächenänderungen, nur ein definiertes numerisches Rechenbudget. Für breitenabhängige Eingriffe bei unbekannter Breite gibt es keine Freigabe. Bei unsicherer Breite werden Kandidaten über den zugelassenen Bereich geprüft; wenige Stichproben sind nur ein Test, kein Beweis für das gesamte Intervall. Die erste produktive Version verwendet konservative Hüllen oder behält den Kandidaten, wenn sich robuste Abdeckung nicht belegen lässt.

Der Kreis wird numerisch angenähert. Die Demo nutzt 32 Segmente je Viertelkreis. Produktion muss den maximalen radialen Näherungsfehler `r × (1 − cos(π/(4q)))` in das Fehlerbudget aufnehmen. Der in der Demo verwendete diskrete Hausdorff-Abstand ist ein Prüfwert, keine garantierte kontinuierliche Schranke. Produktion braucht adaptive Nachverdichtung bzw. eine konservative obere Schranke. Rasterbilder helfen bei der visuellen Kontrolle, entscheiden aber nicht allein über das Löschen subpixelgroßer Details.

### Verarbeitung in nachvollziehbaren Stufen

1. **Vorbereitung:** Unveränderlichen Dokument-/Profilstand aufnehmen; transformieren; Masken, Plotgrenzen und Hindernisse anwenden; Attribute/Quellen erhalten. Der eingefärbte Strichrand wird bei der Papierprüfung berücksichtigt. Werkzeug-/Halterkollisionen brauchen weiterhin die eigenen mechanischen Abstände, nicht den Tintenradius.
2. **Exakte Bereinigung:** Aufeinanderfolgende Koordinatenduplikate und exakt kollineare Zwischenpunkte entfernen, sofern keine Druck-/Tempo-/Punktbedeutung daran hängt. Schnittstellen und Teilüberlappungen zerlegen; identische atomare Strecken richtungsunabhängig einmal behalten. Scharfe Knicke und Knoten schützen. Rundungsfehler dürfen keine nahe Parallelspur zusammenziehen.
3. **Punktreduktion:** Kurven abschnittsweise zwischen geschützten Ankern vereinfachen. Toleranz zunächst klein und stiftabhängig, anschließend Flächen-/Randprüfung; bei Überschreitung zurücknehmen. Ein allgemeines `preserve_topology=True` allein garantiert nicht die Beziehungen zwischen unabhängig vereinfachten Objekten: Netzknoten müssen explizit geteilt und geprüft werden. [Shapely simplify](https://shapely.readthedocs.io/en/2.1.2/reference/shapely.simplify.html).
4. **Überdeckung:** Zunächst ganze redundant eingefärbte Striche/Punkte entfernen. Kandidaten über räumliche Nachbarschaft finden und deterministisch prüfen. Priorität: große echte Einsparung bei kleinem Qualitätsrisiko. Später Teilstrecken kürzen; dabei zusätzliche Anhebungen und sichtbare Endkappen mitbewerten. Niemals die Mittellinie einfach aus der bisherigen Farbfläche herausschneiden: Der verbleibende Stiftauftrag ist wieder eine Fläche.
5. **Füllungen:** Bei bekannter Generatorrolle Schraffurabstände aus Strichbreite und gewünschter Deckung neu erzeugen. Im Inneren einer ideal deckenden Fläche kann paralleler Abstand höchstens etwa der wirksamen Breite sein; Ränder, Kurven, Streuung und Tintenauftrag verlangen weitere Prüfung. Tonwertschraffur/Pointillismus und Kreuzschraffur bleiben zunächst geschützt. Sie durch einfaches Ausdünnen aufzuhellen wäre keine gleichwertige Optimierung.
6. **Routen:** Mindestens unveränderte Reihenfolge, einmalige Kanten und gegebenenfalls Nachzeichnen vorhandener Kanten vergleichen. Keine sichtbaren neuen Verbindungslinien. Verbindungen durch bestehende Tinte sind spätere Kandidaten mit gleicher Flächenprüfung, keine Erlaubnis zum allgemeinen Überbrücken von Lücken. Der aktuelle Wert `merge_tolerance=0.5` wird nicht in die neue Pipeline als pauschale Qualitätstoleranz übernommen.
7. **Abschluss:** Mit tatsächlichem Start, Hindernissen, Parkfahrt und Z-Profil G-Code erzeugen; Rundung auf 0,001 mm mitprüfen; Bewegungsgrenzen prüfen; Kennzahlen und Fehlerbericht am finalen Ergebnis berechnen. Wenn der Kandidat die Grenzen verfehlt, auf die letzte gültige Stufe zurückfallen und den Grund nennen.

Die Auswahl ist eine beschränkte Optimierung: zuerst Qualitäts-/Semantikbedingungen erfüllen, dann Zeit, Nachzeichnen und Datenmenge vergleichen. Ein globales mathematisches Optimum wird nicht versprochen. Zeitvorteile innerhalb der Modellunsicherheit werden als „ähnlich“ behandelt. Bei unbekannter Dynamik bevorzugt die Empfehlung unter qualitativ gleichwertigen Kandidaten den Plan mit wenig Nachzeichnen; der Nutzer kann „Weniger Anheben“ ausdrücklich wählen.

## Architektur und API-Verträge

Vorgeschlagene Module mit einer klaren Aufgabe:

```text
plotter/plotplan/
  model.py           PlotStroke, PenSetup, Policy, PlotPlan, Report
  scene_adapter.py   Objekttransformation, Attribute, Masken
  drawing_adapter.py SVG/PDF-Platzierung in finale mm
  normalize.py       Knoten, Überlappungen, exakte Bereinigung
  simplify.py        Anker und begrenzte Punktreduktion
  coverage.py        Stiftflächen, lokale Indexierung, Löschkandidaten
  quality.py         Fehlerbudgets, Semantik, abschließende Prüfung
  routing.py         Routenvergleich und bestehende Routenhelfer
  timing.py          Dynamikparameter und Unsicherheit
  service.py         Jobsteuerung, Snapshot, Cache, Abbruch
```

`build_plot_plan(source, calibration, pen_setup, policy) -> PlotPlan` bleibt ohne Datei-/Druckerzugriff. `PlotPlan` enthält versionierte Eingabe-Hashes, Stift-/Policy-Snapshot, Wege mit Attributen, Messwerte vorher/nachher, verworfene Kandidaten samt Gründen und Prüfstatus. G-Code-Ausgabe und Planberechnung werden getrennt; der Encoder darf danach keine weitere versteckte Linienoptimierung ausführen.

Die Auswahl wird pro Slide als optionale `plotOptimization` gespeichert:
`{version: 1, mode: 'off' | 'exact' | 'balanced', route: 'auto' | 'single_pass' |
'few_lifts', protectedObjectIds: string[]}`. Fehlender Wert bedeutet `off`.
Toleranzen gehören zu einer versionierten Policy, nicht zu frei geratenen
Anfänger-Reglern. Für die erste Messphase können sie in einem expliziten
Experimentmodus verändert werden; jeder Bericht enthält die tatsächlichen
Werte. `continuous` bleibt für alte Slides kompatibel. Sobald eine neue Policy
aktiv ist, entscheidet nur deren `route`; ein alter Boolean darf das fertige
Ergebnis nicht nachträglich verändern.

Beispiel eines erfolgreichen Reports:
`{status: 'ready', inputHash, planHash, policyVersion, penFingerprint,
before: {drawMm, travelMm, contacts, points, estimatedSeconds}, after: {...},
quality: {missingAreaMm2, addedAreaMm2, maxBoundaryErrorMm, protectedLost: 0},
appliedStages, skippedGroups, warnings}`. `quality` darf nur als vollständig
geprüft erscheinen, wenn alle erforderlichen Gruppenprüfungen abgeschlossen
sind. Bei Teilprüfung erhält der unveränderte bzw. konservativ optimierte
Fallback einen eigenen Hash und einen eigenen Status. Der Client zeigt dessen
Kennzahlen, keine Mischung aus vorgeschlagenem und tatsächlich nutzbarem Plan.

Vorgeschlagene Endpunkte (an vorhandene Jobinfrastruktur anpassen):

- `POST /api/pages/{id}/plot-plan`: erfasst `expectedRevision`, Projekt-/Profilidentität, effektive Einstellungen und Policy; liefert `202` mit Task-ID. Ein vorhandener gültiger Cachetreffer darf sofort geliefert werden.
- `GET /api/plot-plans/{taskId}`: Fortschritt nach Stufe, Status, Hash, Kennzahlen, begrenzte Vorschau und Ergebnisreferenz. Große Wege binär/kompakt übertragen, keine mehrfachen riesigen JSON-Bäume.
- `DELETE /api/plot-plans/{taskId}`: kooperativer Abbruch; laufende Prozessarbeit nötigenfalls verwerfen. Abbruch startet niemals die Originalzeichnung automatisch.
- Plot-/Exportaufruf erhält `planId`, `planHash`, erwartete Dokumentrevision und Profil-/Stift-Hashes. Bei Abweichung `409` und Neuberechnung; kein stiller Wechsel auf einen anderen Plan.

Gespeicherte und noch nicht gespeicherte Vorschau müssen dieselbe Semantik besitzen. Entweder wartet der Client auf Autosave oder sendet einen expliziten Entwurf samt Inhaltshash. Der spätere Plot muss exakt denselben Inhalt binden. Ein Projektwechsel während der Berechnung ändert den Zielkontext nicht; verspätete Ergebnisse überschreiben keine neuere Vorschau.

Cache-Schlüssel: Geometrie inklusive Masken/Transforms/Attribute, finaler Maßstab, relevante Kalibrierung, PenFingerprint, Policy-Version, Algorithmus-Version, Bewegungsmodell. Reine Layout-/Zoomänderungen invalidieren nichts. Vorschau, Score, Download und Druck verweisen auf denselben unveränderlichen Plan. Jobmetadaten enthalten diesen Snapshot. Alte Jobs laufen unter ihrer bisherigen Validierung; ihnen wird keine neue Optimierung unterstellt.

Datei-/Profilimport und -export müssen `penSetup` und Versionsgrenzen verlustfrei behandeln. Unbekannte zukünftige Policy-Versionen werden nicht als heutige Defaults interpretiert.

## Performance und Stabilität

`benchmark.py` misst Bausteine, keinen kompletten Optimierer. In einem lokalen Lauf brauchte die Vereinfachung von 400.000 Punkten bei 0,002 mm Toleranz etwa 239 ms. Der räumliche Index reduzierte beim getrennten Kurvensatz 10.000 mögliche Paare auf 100 Selbstpaare. Bei 1.000 dicht überlagerten Linien entstanden trotzdem 1.000.000 gerichtete Kandidatenpaare; die Abfrage dauerte etwa 608 ms.

Die kleine Schraffur-Demo baut dagegen pro Löschversuch alle Flächen neu auf und benötigt schon für 61 Linien ungefähr zwei Sekunden. Diese absichtlich einfache Referenz ist ungeeignet als Produktionsalgorithmus.

Produktionsstrategie:

- Günstige exakte Reduktion vor teurer Flächenrechnung. Linien in begrenzte räumliche Stücke zerlegen, lange Diagonalen nicht als riesige Bounding-Box-Nachbarschaft behandeln.
- STRtree oder gleichwertiger Index für Kandidaten; der Baum ist statisch und muss nach strukturellen Änderungen kontrolliert neu aufgebaut werden. Kandidatenlisten auf aktuelle Überlebende filtern. [STRtree-Dokumentation](https://shapely.readthedocs.io/en/2.1.2/strtree.html).
- Lokale Flächen-Caches pro Kachel mit ausreichendem Überlappungsrand. Abhängigkeiten zwischen gelöschten Wegen und gecachter Abdeckung invalidieren. Globale Finalprüfung und Detailprüfung dürfen durch Kachelung nicht entfallen.
- Für dichte Flächen Kandidaten blockweise und mit festen Arbeitsbudgets verarbeiten; keine unbeschränkte Million-Paar-Matrix im UI. Schraffuren mit bekannten Generatorparametern separat behandeln.
- Rechenarbeit in abbrechbarem Hintergrundprozess; UI behält die letzte vollständige Zeichnung. Keine Anwendung des aktuellen Fortschritts als fertiger Plotplan.
- Bei Speicher-/Zeitlimit bleibt ein geprüfter konservativer Plan verfügbar. UI meldet „Flächenoptimierung nicht vollständig geprüft“ und die tatsächlich angewandten Stufen. Kein stilles Auslassen von Geometrie.
- Deterministische Sortierung mit stabilen Quell-IDs; gleiche Eingabe/Version ergibt gleichen Planhash. Caches begrenzen und bei Fehlern freigeben.

Vorläufige Leistungsziele auf einer dokumentierten Referenzmaschine: UI-Antwort unter 100 ms, Abbruchbestätigung unter 500 ms, exakte Analyse von 100.000 Punkten im niedrigen Sekundenbereich, 400.000 Punkte mit sichtbarem Fortschritt und begrenztem Speicher. Das sind Abnahmekriterien für künftige Messungen, keine bereits erreichten End-to-End-Werte.

## Kompakte Bedienung im Editor

Kein neuer Haupttab. In den vorhandenen Plot-/Vorschaubereich kommt „Stift & Optimierung“. Stiftname, Breite und Messstatus stehen als kurze Statuszeile am Dokument; Bearbeitungswerkzeuge behalten ihren Platz.

Der angedockte Bereich hat drei kleine Unterseiten, jeweils mit fester Aktionszeile:

1. **Stift:** aktuelle Breite, Quelle, Papier, „Breite prüfen“. Kein zweiter vollständiger Einrichtungsassistent im Editor.
2. **Optimierung:** `Aus`, `Form exakt`, `Ausgewogen`. „Aus“ ist der Migrationszustand. „Form exakt“ entfernt passende exakte Redundanz; „Ausgewogen“ nutzt nach ausdrücklicher Auswahl die gemessene Breite. Spezielle Details lassen sich über „Details schützen“ ausnehmen. Ungültige Druck-/Reihenfolgegruppen erklären ihren Ausschluss.
3. **Vergleich:** ursprüngliches Plotbild, optimiertes Plotbild, Unterschiede oder Werkzeugwege. Ein zentraler Maßstab bleibt zwischen den Ansichten gleich. Rot markiert fehlende, Grün zusätzliche Tinte; Konturen/Legende machen den Vergleich auch ohne Farberkennung lesbar.

Die kompakte Ergebnistabelle zeigt Zeichenweg, Leerfahrt, Kontakte, Koordinatenpunkte, Nachzeichnen und geschätzte Zeit. Unsichere Zeiten sind als Schätzung gekennzeichnet, nicht als garantierte Prozentersparnis. „Keine sichere Vereinfachung gefunden“ ist ein gültiges Ergebnis. Ein erklärender Satz nennt etwa „Parallelstriche erhalten: würden das Motiv verbreitern“.

Breitenvorschau und Auswahlbedienung sind getrennt: physischer Strich skaliert mit dem Zoom, Trefferbereiche und Griffe behalten ihre Bildschirmgröße. Umrisse werden in endgültigen Papierkoordinaten gerendert, auch bei nicht gleichmäßigen Objekttransformationen. Große Ergebnisse verwenden vollständige Kacheln/Vektoren und dieselben Regeln gegen verschwindende Linien wie der korrigierte Designer.

Bei 1024×768 und 1366×768 müssen die drei Unterseiten ohne abgeschnittene Aktionen passen. Lange Detailberichte können gezielt in einem eigenen lesbaren Bericht geöffnet werden; der normale Arbeitsablauf braucht keine wachsenden Einstellungslisten.

## Umsetzung in prüfbaren Etappen

| Etappe | Inhalt und eigene Commits | Abnahme vor dem nächsten Schritt |
| --- | --- | --- |
| 0 – Referenz | Diese Planung, deterministische Fixtures, Demo und Rohdaten | Gegenbeispiele reproduzierbar; Modellgrenzen dokumentiert |
| 1 – Gemeinsamer Plotplan | Zwischenmodell, Szene-Adapter, Encoder entkoppeln, Identitätsmodus | Bestehende ungeänderte Jobs erzeugen gleichen relevanten Bewegungsablauf; Druck/Tempo/Masken bleiben korrekt |
| 2 – Stift erfassen | Profilmodell/Validator, Import/Export, Messbedingungen, kompakte UI/Testkarte | Alte Profile funktionieren; Stiftwechsel invalidiert nur passende neue Pläne; reale Testkarte später geprüft |
| 3 – Vorschau und Report | Physische Tintenbreite, Original/Ergebnis/Differenz, Kennzahlen | Breite korrekt nach Zoom/Skalierung; keine Originaldatenänderung; gleiche Plan-ID für Preview/Plot |
| 4 – Exakte Optimierung | Kollinearität, Teilüberlappungen, eindeutige Strecken, sichere Routenkandidaten | 0 absichtlicher Flächenverlust; kein Verlust markierter Punkte, Druck-/Tempo- oder Reihenfolgedaten |
| 5 – Begrenzte Vereinfachung | Anker, Kurvenreduktion, Fehlerbudget und Rücknahme | Numerik-/Rundungsbudget eingehalten; lokale und globale Prüfungen bestehen |
| 6 – Breitenabhängige Entfernung | Ganze überdeckte Wege/Punkte, Index/Caches, robuste Grenzen | Satzpunkte/kleine Schleifen bleiben; kein gegenseitiges Weglöschen; Last-/Abbruchtests |
| 7 – Routen und Zeit | Messbare Dynamikparameter, Nachzeichnen gegen Anheben, Start-/Parkweg | Kein Zeitversprechen auf Segmentzahlbasis; auf realen Proben plausibel kalibriert |
| 8 – Füllungen und Importpfade | Schraffurgenerator, später Teilstrecken; SVG/PDF/CLI-Adapter | Einheitliche mm-Semantik nach Skalierung; keine Doppeloptimierung; bewusst erhaltene Tonwerte |
| 9 – Freigabe | Desktop-Browser, DEB/Flatpak, reale Vergleichsplots, Exportdokumentation | Qualitäts-, Stabilitäts- und Laufzeitkriterien erfüllt; unabhängiges Zurückrollen möglich |

Etappen 1–6 ergeben die erste nutzbare Variante für Designer-Seiten. Etappen 7–9 schließen Zeitkalibrierung und alle übrigen Erzeugungswege ab. Generative Schraffuranpassung und variable Stiftmodelle dürfen die konservative erste Variante nicht blockieren. Keine pauschale „in acht Stunden fertig“-Zusage: Nach Etappe 4 ist mit echten Beispielen zu bewerten, ob Flächenindexierung und Attributerhaltung weitere Arbeit benötigen.

## Prüfmatrix und Freigabekriterien

| Gruppe | Fälle | Erwartung |
| --- | --- | --- |
| Exakte Geometrie | Vorwärts/rückwärts, unterschiedliche Unterteilung, Teilüberlappung, kreuzende/kollineare Linien | Redundanz fällt weg; neue Verbindungen entstehen nicht |
| Sichtbare Details | Satzpunkte, i/j-Punkte, kurze Striche, kleine Ringe, schmale Löcher, nahe Parallelspuren | Geschützte Details identisch; Verlustgrenzen lokal und global eingehalten |
| Schriften/Import | Quellreihenfolge, variable Feeds, Xournal-Druck, maskierte Teilstücke, beabsichtigte Wiederholung | Attribute und Reihenfolge erhalten; ungeeignete Gruppen ausgeschlossen |
| Transformation | 0,1×/1×/10×, Spiegelung, Rotation, nicht uniforme Skalierung, Papierwechsel | Stift bleibt physisch gleich breit; Entscheidungen abhängig von finalen mm |
| Stift | Unbekannt, nominell, gemessen, ungültige Zahlen, unsicherer Bereich, neue Messbedingungen | Klare Zustände; keine Entfernung mit erfundener Genauigkeit |
| Numerik | Fast identische Punkte, 0,001-mm-G-Code-Rundung, kollabierende Segmente, große Koordinaten | Finaler G-Code nochmals geprüft; kein NaN/Inf; markierte Punkte erhalten |
| Pipeline | Scene/SVG/PDF/CLI, gleicher Plan für Vorschau/Score/Plot | Keine abweichende zweite Optimierung |
| Nebenläufigkeit | Projektwechsel, Seitenrevision, Stiftwechsel während Rechnung, Abbruch, Wiederholung | Veraltete Antworten verworfen; Hash-/Snapshot-Konflikte explizit |
| Last | 20k/100k/400k/1M Punkte, 1k/10k/50k Striche, dichte Überlagerung | Speicher-/Zeitbudget, reproduzierbarer Fallback, Oberfläche weiter bedienbar |
| Eigenschaften | Determinismus, unveränderte Eingabe, Metadaten, erneute Optimierung | Gleiche Eingabe gleicher Plan; jede weitere Anwendung prüft gegen Original statt fortgesetzter Erosion |
| Praxis | Dünner Fineliner, mittlerer Gelstift, dicker Stift; mindestens zwei Papiere | Echte Breite, Lesbarkeit, Tintenauftrag, Laufzeit vor/nachher dokumentiert |

Hardware-Protokoll: Z-/Papierkalibrierung zuerst; identische Original-/Optimiert-Motive nebeneinander mit gleicher Größe/Geschwindigkeit; Richtung/Position der Proben variieren; mindestens drei Zeitläufe je gewähltem Fall. Tatsächliche Dauer, Stiftkontakte und Scan/Makrobild getrennt vom Modellbericht aufzeichnen. Ein einzelnes gutes Bild bestätigt keine allgemeine Qualitätsgrenze.

Freigabe erst, wenn die automatischen Tests wichtige Details erhalten, keine ungeprüften Pläne plotten und reale Testplots die gewählten Toleranzen tragen. Bis dahin bleibt „Ausgewogen“ bewusst wählbar und als modellbasierte Optimierung erkennbar. Eine spätere automatische Empfehlung basiert auf validierten Stift-/Papierbedingungen.

## Offene Entscheidungen mit vorgesehenem Vorgehen

- **Tintenauftrag:** Binäre Fläche berücksichtigt keine Verdunkelung durch Mehrfachfahren. Zunächst beabsichtigte Mehrfachdurchgänge schützen; später optionales Tonwert-/Überfahrtenmodell.
- **Unbekannte Importsemantik:** Nicht erraten, ob ein Punkt ein Satzzeichen oder Rauschen ist. Ganze unbekannte Details konservativ erhalten; Nutzer kann Gruppen gezielt freigeben.
- **Variable Breite:** Rund und konstant zuerst. Messkurve bzw. elliptischer richtungsabhängiger Fußabdruck später mit eigener Validierung.
- **Teilüberdeckungen:** Zunächst ganze Wege entfernen. Partielles Aufteilen folgt erst mit Kostenrechnung, Endkappenprüfung und Schwelle gegen viele winzige Reststücke.
- **Zeitmodell:** Aktuelle Schätzung und einfache zweite Rechnung dienen als Diagnose. Gemessene Maschinenparameter und Lookahead-nähere Rechnung sind Voraussetzung für verlässliche automatische Zeitwahl.
- **Skalierung:** Die Demo beweist die Fachregeln, nicht die Skalierbarkeit. Lokale Caches, Abbruch und dichte Worst-Case-Daten sind eine eigene Etappe.

Technische Referenzen: [vpype Optimierungsbefehle](https://vpype.readthedocs.io/en/stable/reference.html) für bestehende Linienwerkzeuge; [Shapely 2.1.2 buffer](https://shapely.readthedocs.io/en/2.1.2/reference/shapely.buffer.html), [simplify](https://shapely.readthedocs.io/en/2.1.2/reference/shapely.simplify.html) und [STRtree](https://shapely.readthedocs.io/en/2.1.2/strtree.html). Die Qualitätsschwellen und Architektur sind projektspezifische Vorschläge und werden nicht durch diese Bibliotheksdokumentation als physisch richtig bestätigt.

## Durchgeführte Prüfung der Prototypen

Alle sechs Demo-Fälle und acht Routenkandidaten wurden ausgeführt. Zehn
zusätzliche Invariantenprüfungen bestehen, darunter gegenseitige Überdeckung,
Schutz eines geometrisch redundanten Details, Rotations-/Translationsverhalten
und Stabilität gegen unterschiedliche Kreisauflösungen. Ein zweiter kompletter
Lauf ergab dieselben Geometrie-, Qualitäts- und Zeitmodellwerte; nur gemessene
Rechenlaufzeiten wurden beim Vergleich ausgeschlossen. Ruff besteht für alle
drei Skripte. Der HTML-Bericht mit 18 SVG-Ansichten wurde in Firefox bei 1440
Pixeln Breite visuell geprüft; kein horizontaler Überlauf. Die App-Testreihen
wurden für diese reine Planung nicht erneut ausgeführt. Hardwaretests stehen
für die spätere Implementierung aus.
