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
