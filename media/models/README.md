# GCodeScribe Ai3MS · Hardware v2

Aktuelle Druckteile für die Stifthalterung am **Anycubic i3 Mega S**. Die Hardwareversion v2 ist unabhängig von der Softwareversion v0.6.1.

## Downloads

| Druckteil | STL | Abmessungen der STL-Hüllbox |
|---|---|---|
| Druckerhalterung | [mount](GCodeScribe-Ai3MS-v2-mount.stl) | ca. 48,91 × 55,51 × 29 mm |
| Stifthalter | [pen](GCodeScribe-Ai3MS-v2-pen.stl) | ca. 31,5 × 70 × 27,75 mm |
| Platte | [plate](GCodeScribe-Ai3MS-v2-plate.stl) | ca. 40 × 61 × 29 mm |

- [Alle drei Druckteile als ZIP](GCodeScribe-Ai3MS-v2-print-parts.zip)
- [Bearbeitbares STEP-Modell](GCodeScribe-Ai3MS-v2.step)
- [Native Fusion-Konstruktion](GCodeScribe-Ai3MS-v2.f3d)

Die Abmessungen wurden aus den STL-Koordinaten bestimmt; sie sind keine Druckorientierungsempfehlung. Alle Teile mit **100 % Skalierung** in Millimetern importieren. Orientierung, Stützen und Druckprofil anhand der Geometrie und des eigenen Druckers wählen. Maschinenfertiger G-Code wird bewusst nicht als universelle Druckdatei angeboten.

## Material und Werkzeug

| Material | Anzahl |
|---|---:|
| Magnete mit 5 mm Durchmesser | 10 |
| M3-Innengewindeeinsätze | 2 |
| M3-Schrauben | 2 |
| Mittelgroßes Gummiband | 1 |
| Filament | für drei Druckteile |
| Flüssiger Sekundenkleber | nach Bedarf |

Werkzeug: passender Innensechskantschlüssel und optional ein kleiner Hammer zum Einsetzen der Magnete. Die STEP-Datei enthält Aufnahmen mit 2,5 mm Radius. Die jeweils passende Magnetdicke, Schraubenlänge und Einsatzgeometrie vor dem Einkauf beziehungsweise Einbau an der Konstruktion prüfen.

## Montageablauf

1. Die drei v2-Teile drucken, Stützreste entfernen und Passflächen prüfen.
2. Magnetpaare vor dem Einkleben auf ihre spätere Ausrichtung zueinander prüfen. Magnete passend einsetzen und mit flüssigem Sekundenkleber befestigen; den Kleber aushärten lassen.
3. Die M3-Gewindeeinsätze passend zu deren Bauart einsetzen. Die Druckerhalterung mit den zwei M3-Schrauben befestigen.
4. Platte und Stifthalter anhand des STEP-/Fusion-Modells zusammenfügen und das mittelgroße Gummiband an den vorgesehenen Aufnahmen einsetzen.
5. In GCodeScribe ein zur Maschine passendes Profil wählen, die Einsetzposition bestimmen und die Stifthöhen kalibrieren. Danach Papier-Ecken und Testpunkte prüfen.

Das [Montagefoto](../hardware/pen-mount-printer.jpg) zeigt das Funktionsprinzip der gedruckten Halterung. Es dokumentiert nicht verbindlich jedes Detail der v2-Geometrie.

Der [Release-Download](https://github.com/Friedjof/gcodescribe/releases/tag/v0.6.1) enthält die drei STLs, das ZIP und beide CAD-Dateien zusätzlich als direkt herunterladbare Anhänge.

## Frühere Modelle

Unter [`old/`](old/) bleiben frühere STL-, STEP-, Fusion- und experimentelle Modellstände erhalten. Sie gehören nicht zum aktuellen v2-Drucksatz und sollten nicht mit dessen Teilen vermischt werden.

Die drei separaten v2-STLs wurden aus den bereitgestellten Dateien `CGodeScribe-Ai3MS_v2.0_{mount,pen,plate}.stl` übernommen. Die ursprünglichen Dateien im Download-Ordner bleiben unverändert.
