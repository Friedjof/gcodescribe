# Stiftbreite und Plotoptimierung als Offline Experiment

Die Skripte prüfen die fachlichen Annahmen der [Planung](../../docs/pen-width-optimization-plan.md). Sie schreiben ausschließlich eigene Berichte, verwenden synthetische Millimeter-Geometrie und kommunizieren mit keinem Drucker oder laufenden App-Datenspeicher.

Vom Repository aus:

```bash
.venv/bin/python experiments/pen-width/demo.py
.venv/bin/python experiments/pen-width/checks.py
.venv/bin/python experiments/pen-width/benchmark.py
```

Die bestehende Projektumgebung enthält Shapely und die App-Abhängigkeiten. `demo.py --output /tmp/pen-width-demo` erlaubt einen anderen Ausgabeordner. Der Demo-Aufruf prüft die sechs Referenzfälle und drei Gegenbeispiele selbst, einschließlich unveränderter Eingaben und identischer Farbfläche bei den acht Routenkandidaten. `checks.py` prüft zusätzlich Eingabereihenfolge, gegenseitige Überdeckung, geschützte Duplikate, Rotation/Translation und numerische Auflösung.

- [Vergleichsbilder und Erläuterungen](results/index.html): eigenständige HTML-Datei, direkt im Browser zu öffnen.
- [Rohwerte](results/metrics.json): Flächen, Wege, Punkte, zwei Zeitmodelle, Toleranzrücknahme und Breiten-/Abstandsraster.
- [Bausteinbenchmark](results/benchmark.json): Laufzeiten von Geometrieaufbau, Vereinfachung und Indexierung; dichter Worst Case ausdrücklich enthalten.
- Einzelne SVGs unter `results/` für Original und Kandidat; im Browser gezoomt, nicht zur Messung einer realen Stiftbreite geeignet.

Das Prototypmodell setzt runde, konstante, deckende Striche voraus. Wiederholter Tintenauftrag, Papierfasern, Stiftmechanik, variable Breite und Firmwaredynamik sind nicht simuliert. Geschützte Attribute sind in den Fixtures ausdrücklich markiert, nicht automatisch erkannt. Die naive Flächenberechnung baut pro Kandidat die komplette Vereinigung neu auf; sie ist eine Referenz für kleine Fälle und kein produktionsfähiger Optimierer.

0,25 % Flächenbudget und 5 % der Stiftbreite als Randtoleranz sind Versuchsparameter. Die Demo prüft global; die Planung fordert für die App zusätzlich lokale Budgets, Semantik- und Topologieprüfungen. Der diskrete Hausdorff-Abstand und polygonal approximierte Kreise sind keine exakte Fehlergarantie. Die Ergebnisse stellen vorgeschlagene Kandidaten dar, keine automatisch freigegebenen Druckaufträge.

Die erste Zeitrechnung verwendet den bestehenden G-Code-Analysator, die zweite eine kontinuierliche Feedrate plus Hub-/Kontaktkosten. Keine davon ist gemessene Plotzeit. Der Benchmark ist ein einzelner lokaler Lauf; seine Zeiten schwanken. Bei erneuter Ausführung sind Geometrieergebnisse deterministisch, Laufzeiten dagegen nicht.
