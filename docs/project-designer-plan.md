# Projekte im Designer

Status: umgesetzt (19.10.2026).

## Bedienung

- Der Projektname links öffnet die Projektübersicht als Popup. Dort lassen sich Projekte suchen, anlegen, öffnen, umbenennen, archivieren und wiederherstellen.
- Ein neues Projekt bekommt ein eigenes Profil. Beim Anlegen kann ein vorhandenes Profil als Vorlage kopiert werden. Die Projekt-Einstellungen bearbeiten dieses Profil direkt im Popup, einschließlich Papierfläche, Plotbereich, Stifthöhen, Vorschüben, Positionen und Hindernissen.
- Links erscheinen nur Ordner und Slides des geöffneten Projekts. Ordner lassen sich verschachteln, umbenennen, verschieben und löschen. Slides lassen sich in Ordner und ausdrücklich in ein anderes Projekt verschieben. Der Ordnerbaum hat keine eigenen Profilgruppen.
- Neue Slides übernehmen die aktuelle Kalibrierung des Projektprofils als Snapshot. Eine spätere Profiländerung verändert bestehende Slides nicht. Im Popup kann das gespeicherte Projektprofil ausdrücklich auf den geöffneten Slide übernommen werden; dabei wird geprüft, ob seine Inhalte in den Plotbereich passen.
- Der Designer zeigt keinen veralteten Profilstatus. Slide-Liste und Speichern erzeugen keinen G-Code und keine 3D-Vorschau. Diese Berechnung beginnt erst bei Vorschau, G-Code-Erzeugung oder Plotten und verwendet dann die aktuelle Projektkalibrierung.
- Die Kalibrierposition und der Anpressdruck aus dem Designer verwenden das Projektprofil, auch wenn global ein anderes Profil aktiv ist.

## Speicherung und Migration

`paint_index` enthält Projekte, Ordner und kompakte Slide-Metadaten. Die eigentlichen Slide-Inhalte bleiben unter `paint_page_<id>`. Beim ersten Lesen eines alten Index wird eine Sicherung als `paint_index_before_projects` und je Slide als `paint_page_before_projects_<id>` geschrieben. Bestehende IDs und Inhalte bleiben erhalten; bisherige Profilgruppen werden in Projekte aufgeteilt.

Jeder Slide besitzt `projectId`, `groupId` und `profileSnapshot` mit Kalibrierung und Fingerprint. Ist ein altes Profil nicht mehr vorhanden oder sein Fingerprint inzwischen geändert, lässt sich die damalige Kalibrierung nicht sicher rekonstruieren. Für einen solchen Slide ist vor Vorschau oder Plotten die ausdrückliche Übernahme des Projektprofils nötig.

Das aktive Projekt liegt derzeit im gemeinsamen Dokumentindex; die zuletzt geöffnete Slide wird pro Projekt gespeichert. Ein Projektwechsel speichert ausstehende Editoränderungen vor dem Laden der Ziel-Slide.

## Plotten und Sicherheit

Designer-Jobs tragen einen Snapshot der beim Erzeugen aktuellen Projektkalibrierung in ihren Job-Metadaten. Der Drucker prüft diesen gegen die aktuelle Projektkalibrierung sowie gegen die Bett- und Z-Grenzen des aktiven Maschinenprofils. Wird die Projektkalibrierung nachträglich geändert, muss der G-Code neu erzeugt werden. Für andere Jobs gilt weiterhin die Prüfung des global aktiven Profils. Das tatsächliche Senden an einen Drucker wurde automatisiert mit einem simulierten Client geprüft; ein physischer Test steht aus.

## Modulgrenzen im Designer

`Paint.tsx` verbindet die Oberfläche mit drei Controllern:

- `usePaintDocument` synchronisiert Seiten, Speicherstatus und abgeschlossene Importe. Lokale Entwürfe bleiben während Hintergrundaktualisierungen erhalten.
- `usePaintCanvasActions` übersetzt Zeichenaktionen, Füllungen und Texteinfügen in Objektbefehle.
- `usePaintJobs` verwaltet G-Code-Erzeugung, Vorschau und Druckstart. Ein synchroner Sperrstatus verhindert doppelte Befehle. Vor einem Druckstart wird nach jedem vorbereitenden Schritt geprüft, ob Seite, Projekt, Profilversion und aktiver Tab noch zur ursprünglichen Aktion gehören. Bereits angenommene Druckaufträge werden nicht automatisch abgebrochen oder erneut gesendet.

Die Seitenleiste (`usePaintPages`) und der Dokumenten-Controller teilen `PageNavigation`. Neue Navigationsabsichten gelten bereits vor dem Warten auf Autosave; laufende Schreibzugriffe werden geordnet abgeschlossen. Nur die aktuelle Navigation darf Seiteninhalt, Auswahl und Verlauf ersetzen. Projektwechsel warten auf bereits gestartete Seitenmutationen. Ein vom gemeinsamen Kontext vorzeitig gemeldetes Zielprojekt wird dabei ausdrücklich berücksichtigt. Verspätete Seiten-, Ordner- und Indexantworten dürfen weder die zuletzt geöffnete Seite noch ein anderes Projekt überschreiben. Umbenennungen übernehmen nur Metadaten; das Löschen einer Hintergrundseite erhält die aktuelle Bearbeitung und ihren Verlauf.

`useObjectOps` bleibt die Schnittstelle für Canvas, Werkzeugleisten und Tastenkürzel. Die Implementierung liegt unter `hooks/objects/`: gemeinsamer Verlauf und Commit-Prüfungen sowie getrennte Text-, Geometrie-, Auswahl- und Transformationsbefehle. Hintergrundberechnungen halten ihre ursprüngliche Seite im Cache fest. Tokens für Text und Stil enthalten die Seiten-ID, weil kopierte Seiten gleiche Objekt-IDs besitzen können. Beim Seitenwechsel werden ausstehende Texteingaben noch auf der ursprünglichen Seite übernommen.

`api/pageEdits.ts` stellt die bisherige Speicher-API bereit. Der injizierbare `api/documents/pageEditStore.ts` besitzt Entwürfe, Warteschlangen und Konfliktbehandlung; `objectPatches.ts` berechnet und verbindet Objektänderungen. Speicherereignisse laufen über typisierte Abonnements. Die App installiert und entfernt Browser-Lebenszyklus-Listener ausdrücklich. Beim Verwerfen bleiben lokale Änderungen erhalten, bis das Serverdokument erfolgreich geladen wurde; inzwischen neu eingegebene Änderungen werden nicht verworfen.

Im Backend bleibt `DocumentStore` die öffentliche Fassade. `core/documents/` trennt Seiten, Projekte und Ordner. Alle Repositories teilen einen `DocumentState` mit derselben reentranten Sperre; Revisionsprüfungen und verschachtelte Schreiboperationen bleiben dadurch atomar. Speicher-Schlüssel und Migrationen bleiben kompatibel. Leere Löschmarkierungen gelten beim Lesen als fehlende Seiten und können durch verspätete Schreibzugriffe nicht wiederhergestellt werden.

## Direkte Canvas-Bedienung

Größen- und Rotationsgriffe haben eine feste Bildschirmgröße und eine größere transparente Trefferfläche. Bei kleinen Objekten werden überlappende Griffe reduziert. Eine Bildschirmanzeige zeigt während des Verschiebens Position und Einraststatus, beim Skalieren Maße in Millimetern und beim Drehen Winkel und Winkeländerung. Die Anzeige bleibt bei gedrehter Ansicht aufrecht und innerhalb der sichtbaren Fläche.

Shift hält beim Skalieren das Seitenverhältnis und rastet beim Drehen in 15°-Schritten ein. Alt umgeht Raster, Ausrichtung und Winkeleinrastung. Escape verwirft eine laufende Geste. Seitenwechsel, Werkzeugwechsel, ausgeblendete Ansicht und Fokusverlust verwerfen ebenfalls ausstehende Vorschauen. Erst beim Loslassen wird die fertige Transformation mit einem Undo-Schritt gespeichert. Größen- und Grenzberechnungen liegen in `canvasTransforms.ts`; Griffdarstellung, Live-Anzeige und Bildschirmmaße sind eigene Komponenten bzw. Hooks.

An der Plotgrenze wird eine Mehrfachauswahl gemeinsam verschoben und bei Bedarf einheitlich verkleinert. Abstände, relative Größen und Spiegelungen bleiben erhalten. Die größere Trefferfläche der Griffe berücksichtigt den tatsächlichen Greifpunkt, damit die erste Mausbewegung keinen Größensprung erzeugt. Bewegungen zurück zum Ausgangszustand erzeugen keinen leeren Undo-Schritt.

## Exakte Maße und Werteingabe

Die aufklappbare Maßleiste über der Zeichenfläche zeigt für ein einzelnes Objekt X/Y, Breite, Höhe, Seitenverhältnis und Drehung. X/Y beziehen sich auf die linke obere Ecke der gedrehten Umrandung, Breite/Höhe auf das ungedrehte Objekt. Der Öffnungszustand wird lokal gespeichert. Die bisherigen Maßfelder im rechten Stilbereich entfallen.

Zahlen bleiben bis Enter oder Fokuswechsel als Entwurf im Feld; Escape verwirft sie. Dezimalkomma, Dezimalpunkt und passende Einheiten werden akzeptiert. Pfeiltasten passen den Entwurf an, mit Shift in größeren Schritten. Diese Eingabe gilt auch für Textgröße, Linien- und Füllungsparameter. Unterschiedliche Objekte und Seiten bekommen getrennte Eingabefelder; bei einer externen Änderung des bearbeiteten Werts wird eine veraltete Eingabe verworfen.

Exakte Transformationsbefehle liegen in `objectMeasurements.ts`. Sie erzeugen einen Undo-Schritt je übernommener Änderung und keinen für ungültige oder unveränderte Werte. Positionen außerhalb der Plotfläche sowie Maße oder Drehungen, die nur durch Verkleinern passen würden, werden erklärt und abgewiesen. Passende Maße werden bei Bedarf durch Verschieben innerhalb der Plotfläche gehalten; ihre eingegebene Größe bleibt erhalten.
