# Interface-Refactoring: Editor über die volle Fensterbreite

Stand: 16.11.2026. Status: Umsetzung nach erweitertem Auftrag vom 16.11.2026. Für Umsetzung und Prüfung stehen ab 00:20 Uhr acht Stunden zur Verfügung; Zieltermin 08:20 Uhr (Europe/Berlin).

## Sicherung und Arbeitsbranch

- Gesicherter Ausgangsstand: `698188a` auf `main`.
- Die letzten Funktionsänderungen liegen getrennt in `f5db2a7` (Zahlenfelder) und `698188a` (Maßleiste).
- Sicherungstag: `interface-refactoring-base-2026-11-16`.
- Neuer Arbeitsbranch: `interface-refactoring` (Git erlaubt keine Leerzeichen in Branchnamen).
- Letzter geprüfter Funktionsstand: 442 Frontend-Tests und Produktions-Build erfolgreich.
- Der vorliegende Plan bekommt einen eigenen Commit auf dem Arbeitsbranch. Die Umsetzung folgt in getrennten, rücknehmbaren Schritten.
- Rückblick auf den Ausgangsstand: `git switch --detach interface-refactoring-base-2026-11-16`. Für eine Weiterentwicklung daraus einen neuen Branch anlegen. Einzelne Umsetzungsschritte später gezielt mit `git revert <commit>` rückgängig machen. Vor einem Branchwechsel eigene Änderungen sichern.

## Verbindliche Richtung aus dem Nutzerfeedback

1. Die App nutzt die volle Breite und Höhe ihres Fensters.
2. Das Erscheinungsbild orientiert sich an einem Dokumenteditor: echte Tabs, kompakte Befehlsgruppen, angedockte Bereiche, klare Trennlinien und eine Statusleiste.
3. Hell ist der Standard, Dunkel eine optionale Darstellung. Weißes Papier und lesbare Zeichnung bleiben in beiden Modi erhalten.
4. Anfänger erhalten einen eigenständigen, verständlichen Einstieg und eine reduzierte Arbeitsoberfläche.
5. Arbeitsbereich-Tabs sind ein-/ausblendbar und umsortierbar. KI-Designer, Schrifteditor und weitere Spezialbereiche sind im Anfängerstandard ausgeblendet.
6. Platzverbrauch und Abstände werden geprüft: insbesondere Canvas-Innenrand, Seitenleisten, Karten-Padding, Werkzeugleisten, Mindesthöhen und feste Rasterauswahl.

Der Entwurf wird direkt auf dem separaten Arbeitsbranch in der App umgesetzt und anhand isolierter Browser-Testprofile geprüft. Tests lösen keine unaufgeforderten Maschinenbewegungen aus.

## Zielaufbau

- **Oben:** flache Arbeitsbereich-Tabs; Programmname kompakt; Druckerzustand und bei laufendem Auftrag „Plot stoppen“ jederzeit sichtbar.
- **Darunter:** Menü und kompakte Befehlsleiste. Gruppen: Bearbeiten, Einfügen, Anordnen, Ansicht, Vorschau/Plotten. Befehle besitzen eindeutige Namen und einheitliche SVG-Symbole.
- **Links:** schmale Werkzeugleiste; daneben bei Bedarf das angedockte Projekt-/Seitenpanel. Seiten und Objekte lassen sich innerhalb dieses Panels wechseln.
- **Mitte:** durchgehende neutrale Arbeitsfläche mit weißem Papier; optionale Lineale und Maßleiste. Die Fläche wächst sofort mit, wenn ein Panel geschlossen wird.
- **Rechts:** einklappbare Eigenschaften, abhängig von Werkzeug, Objekttyp und Auswahl. Allgemeine Aktionen wie Undo, Zwischenablage und Import stehen in der Befehlsleiste.
- **Unten:** Speicherzustand, Seite/Auswahl, Maßeinheit, Zoom und Hintergrundaufgaben. Dauerhafte Informationszeilen und schwebende Zoom-Pills entfallen.

Arbeitsbereich-Tabs wechseln Funktionen der App. Projektseiten bleiben im Seitenbereich bzw. in optionalen Seitentabs am Dokument. Diese beiden Ebenen bekommen unterscheidbare Gestaltung und Beschriftung.

## Navigation und konfigurierbare Tabs

### Anfängerstandard und Reihenfolge

**Start → Zeichnen → Vorlagen → Aufträge → Einrichten**.

- **Start:** „Bild einfügen“, „Text schreiben“, „Vorlage verwenden“, „Projekt öffnen“ und ein klarer Einrichtungsstatus.
- **Zeichnen:** bisheriger Designer mit Werkzeugen, Seiten, Eigenschaften, Maßleiste und Vorschau.
- **Vorlagen:** bisherige generative Vorlagen/Games.
- **Aufträge:** erzeugte Jobs, Fortschritt und Ergebnisse.
- **Einrichten:** geführter Zugang zu Druckerverbindung, Papier/Plotfläche und Stiftkalibrierung.

Weitere wählbare Bereiche: **Galerie, Profile, Steuerung, Schrifteditor, KI-Designer**. Das sind Umgruppierungen vorhandener Funktionen; vorhandene Inhalte werden erhalten.

### Tab-Verwaltung

- „Tabs anpassen …“ über Ansicht und einen klaren Knopf am Ende der Tab-Leiste.
- Sichtbarkeit per Checkbox, Reihenfolge per Ziehen und per tastaturbedienbaren Hoch-/Runter-Aktionen.
- „Anfängerstandard wiederherstellen“ und „Alle verfügbaren Bereiche“ als ausdrückliche Voreinstellungen.
- Ausgeblendete Bereiche bleiben über „Weitere Bereiche“ erreichbar und können wieder angeheftet werden.
- Mindestens ein verfügbarer Bereich bleibt sichtbar. Wird der aktive Tab ausgeblendet, wird ein sichtbarer Nachbar aktiviert.
- KI-Verfügbarkeit bleibt an die Serverkonfiguration gebunden. Eine UI-Einstellung kann eine deaktivierte Funktion nicht aktivieren.
- Verbergen eines Tabs löscht weder Projekte noch Aufträge noch Entwürfe. Bereits besuchte Editoren behalten ihren Zustand; Hintergrundaufträge laufen mit sichtbarem Status weiter.
- Bei zu wenig Breite: kontrolliertes Überlaufmenü, keine unlesbar zusammengedrückten Tabs.

## Eigenständige Bedienung für Anfänger

Der Anfängerzugang verändert Informationsaufbau, Benennung und Aufgabenführung:

1. **Starten:** eine Aufgabe auswählen statt eine lange Liste technischer Optionen durchsuchen.
2. **Einrichten:** verständliche Zustände für Verbindung, Papier und Stift; der nächste fehlende Schritt ist als Aktion erreichbar.
3. **Bearbeiten:** Auswahl, Verschieben, Größe, Text, Formen und Import sind sichtbar; Schraffuren und Linien besitzen nachvollziehbare Voreinstellungen. Vertiefende Werte stehen unter „Erweitert“.
4. **Vorschau prüfen:** primärer nächster Schritt vor dem Plotten. „G-Code exportieren“ bleibt über Datei bzw. die vollständige Oberfläche erreichbar.
5. **Plotten:** bewusster Benutzerbefehl mit den vorhandenen Profil-, Verbindungs- und Sicherheitsprüfungen.

Hilfe erscheint kontextbezogen bei der jeweiligen Aufgabe. Fortschritt und Fehlertexte benennen eine konkrete nächste Handlung. Die Oberfläche unterscheidet „verbunden“ und „bereit zum Plotten“ anhand der bestehenden Zustandsregeln.

„Geführt“ und „Vollständig“ sind Anzeigepräferenzen. Der Wechsel verändert keine Kalibrierung, löst keine Maschinenbewegung aus und setzt keine Tab-Anpassungen oder Dokumente zurück. „Plot stoppen“ bleibt in allen Modi und Arbeitsbereichen erreichbar.

## Spacing- und Flächenaudit

| Bereich / heutige Vorgabe | Geplante Behandlung |
| --- | --- |
| `.app`: maximal 1680 px / 97 vw, zentriert, Außen-Padding | Fensterfüllender Rahmen ohne äußeren Kartenrand. |
| `.paint`: 16 px Abstand zwischen Hauptbereichen | Angedockte Bereiche mit einfachen Trennlinien und schmalen Splittern. |
| `.card`: 16 px Padding, 16 px Rundung, tiefer Schatten | Editorflächen werden zusammenhängende Panels; Dialoge und echte Inhalte erhalten passende Abstände. |
| Seitenliste: fest 360 px | Standard etwa 220 px, verstellbar und vollständig einklappbar. |
| Eigenschaften: fest 300 px | Standard etwa 260 px, verstellbar und vollständig einklappbar. |
| Werkzeugleiste: 54 px plus Zwischenräume | Kompakte, durchgehende Leiste; ausreichend große Trefferflächen. |
| Canvas: `max(W,H) * 0.04 + 4` als fester Innenrand in Plot-mm | Anzeigeabstand in Bildschirm-Pixeln, getrennt von Dokumenträndern; Ansichten „Papier einpassen“, „Auswahl einpassen“, „Papier maximieren“. Griffe bleiben auch am Rand erreichbar. |
| Canvas-Höhe: `100dvh - 122px`, mindestens 520 px | Flexibles Grid mit `minmax(0, 1fr)`; Leisten bestimmen ihre tatsächliche Höhe. Seitenbereiche scrollen getrennt. |
| Profil-/Maßinformationen dauerhaft oberhalb der Fläche | Kompakter Status unten; Details auf Anforderung; Maßleiste optional. |
| Schwebender Zoom und Aufgaben-Popup über dem Dokument | Zoom und Aufgabenanzeige in der Statusleiste, aufklappbare Details. |
| Rasterabstand nur als feste Auswahl | Bestehende Werte als Voreinstellungen; zusätzlich validierte freie Eingabe. Rasteranzeige und Einrasten getrennt bedienbar. |
| Große allgemeine Button-/Feldabstände | Zwei Dichten: „Komfortabel“ und „Kompakt“. Bedienflächen und Tastaturfokus bleiben gut erkennbar. |

**Wichtige Trennung:** UI-Innenabstände sind Anzeigeeinstellungen. Papier-/Plotränder gehören zur Kalibrierung; der Rasterabstand bleibt eine Dokument-/Bearbeitungseinstellung. „Volle Breite“ entfernt keine physischen Grenzen des Plotters.

Abstandswerte werden durch gemeinsame Tokens vereinheitlicht. Es gibt kein Einstellungsformular für jeden einzelnen Pixel. Sichtbare Panels, Panelbreiten, Dichte, Lineale, Rasteranzeige und optionale Leisten sind die verständlichen Bedienoptionen.

## Gestaltung

- Heller, neutraler Programmrahmen; weiße Papierfläche; zurückhaltendes Blau für aktive Auswahl und Fokus.
- Dunkelmodus verwendet dieselben semantischen Tokens. Portale, Menüs und Dialoge übernehmen das Theme ebenfalls.
- Flache Tabs mit aktiver Unterkante bzw. Verbindung zum Inhaltsbereich; geringe Rundung.
- Panels mit 1-px-Trennlinien, kleine Radien für Controls; Schatten gezielt bei Menüs und Dialogen.
- Systemschrift, kompakte klare Hierarchie, tabellarische Ziffern in Messwerten; reguläre Beschriftung statt übermäßig vieler Großbuchstaben.
- Einheitliche SVG-Symbole statt gemischter Emoji und Sonderzeichen.
- Sichtbare Zustände für Fokus, Auswahl, Fehler, deaktivierte Aktionen und laufende Arbeit. Farbe ist nie die einzige Unterscheidung.
- Keine Abhängigkeit von einer neuen UI-Bibliothek für den Umbau erforderlich.

## Technischer Schnitt

- `AppShell`: Fensterrahmen und Slots für Tabs, Menü/Befehle, Arbeitsbereich und Status.
- `workspaceRegistry`: stabile IDs, Übersetzungen, Reihenfolge, Verfügbarkeit, Komponente und Keep-alive-Regeln.
- `interfacePreferences`: versionierte, validierte UI-Präferenzen; `useInterfacePreferences` als Zugriff.
- `WorkspaceTabs`, `TabSettings`, `CommandBar`, `ToolbarGroup`, `DockPanel`, `SplitPane`, `StatusBar` als begrenzte UI-Bausteine.
- `BeginnerStart` und `SetupOverview`: Aufgabenführung auf Grundlage vorhandener Services und Statusdaten.
- `styles/tokens.css` für Theme, Dichte und Abstände; Shell- und Control-Styles getrennt von Feature-Styles.
- Vorhandene Dokument-, Kalibrierungs-, Job- und Canvas-Controller bleiben die fachlichen Schnittstellen. Ansichten erfinden keine zweite Speicher- oder Druckersteuerung.
- Anzeigepräferenzen bleiben getrennt von Projektinhalt und Druckerkonfiguration. Unbekannte/veraltete gespeicherte Tab-IDs werden sicher verworfen; sinnvolle Standardwerte bleiben vorhanden.
- Layoutwechsel und Panel-Resize berücksichtigen aktive Pointer-Gesten: keine versehentliche Geometrieübernahme, erreichbare Griffe und korrekte Bildschirm-/Plotkoordinaten.
- Alte CSS-Regeln werden pro migriertem Bereich entfernt; keine dauerhafte Sammlung widersprüchlicher Override-Regeln.

## Umsetzung in getrennten Commits

| Schritt | Ergebnis | Abnahme |
| --- | --- | --- |
| A. Shell und Tokens | Volle Fensterfläche, Hell als Standard, optional Dunkel, kompakte Grundelemente. | Breite/Höhe und Portale in beiden Themes; bestehende Ansichten erreichbar. |
| B. Echte Tabs und Präferenzen | Neue Reihenfolge, Verbergen/Anheften, Überlauf, Tastaturbedienung und Reset. | Aktiven Tab verbergen, Server-Flags, Neustart und ungespeicherte Editoren geprüft. |
| C. Angedockter Designer | Verstellbare/einklappbare Panels, durchgehende Arbeitsfläche, Statusleiste und bedarfsgerechte Canvas-Abstände. | Verschiedene Fenstergrößen, Fokusansicht, Resize und Plotgriffe am Rand. |
| D. Befehle und Eigenschaften | Gemeinsame Aktionen oben, reduzierte kontextbezogene Eigenschaften, optionale Maße, klare Voreinstellungen. | Gleiche Befehle/Undo-Funktion, keine doppelten Eingabewege oder verdeckten Aktionen. |
| E. Anfängeroberfläche | Start, Einrichtungsübersicht, geführte Bearbeitung und Vorschau/Plotten. | Neuer Nutzer findet ohne Vorwissen den nächsten Schritt; Moduswechsel erhält Arbeit. |
| F. Übrige Arbeitsbereiche | Vorlagen, Galerie, Aufträge, Profile, Steuerung und optionale Spezialeditoren übernehmen die neue Sprache. | Gleiches Layout-/Fokus-/Theme-Verhalten und verständliche Navigation. |

Ein Schritt kann mehrere kleine Commits umfassen. Funktionsfehler werden als eigene Fix-Commits dokumentiert. Kein Schritt veröffentlicht automatisch ein Release.

## Prüfkriterien

- Browser- und Desktop-Fenster mit z. B. 1366×768, 1920×1080 und 2560×1440; zusätzlich schmale Ansichten und 125/150/200-%-Skalierung.
- Keine äußere Maximalbreite im Editor, kein unnötiger horizontaler Seiten-Scroll; Flächengewinn auf großen Monitoren sichtbar.
- Seiten-/Eigenschaftenpanel lassen sich getrennt schließen und per Tastatur wieder öffnen. Die Arbeitsfläche nutzt die frei werdende Breite.
- Gezeichnete Maße bleiben beim Umstellen von Theme, Dichte, Panels und Tabs unverändert.
- Tab-Reihenfolge und Sichtbarkeit bleiben nach Neustart erhalten; verborgene Editoren verlieren keine Entwürfe.
- Zahlenfeld-, Undo-, Autosave-, Navigation-, Kalibrierungs- und Druckstart-Regressionstests bleiben grün.
- Profile/Verbindung/Job-Status und Plot-Stopp bleiben korrekt; ein verbundenes Gerät wird nicht automatisch als vollständig eingerichtet dargestellt.
- Visuelle Browserprüfungen für beide Themes und kritische Kombinationen; vor dem Release zusätzlich Installation/Update von `.deb` und Flatpak sowie Hardware- und Benachrichtigungs-Praxistests.

## Referenzen

- [draw.io: Editor-Themes und Modi](https://www.drawio.com/docs/manual/editor/appearance/): feste Panels, Tabs und verschiedene Dichten der Editoroberfläche.
- [draw.io: Mehr Platz für die Zeichenfläche](https://www.drawio.com/docs/manual/editor/increase-drawing-canvas/): bedarfsgerechtes Ausblenden von Oberflächenteilen.
- [Office: Registerkarten und Befehlsgruppen](https://support.microsoft.com/en-gb/office/foundations-experiences/customize-the-ribbon-in-office?appver=zsc900&helpid=76843&ns=onenote&syslcid=2057&uilcid=2057&version=90): bekannte Gruppierung von Befehlen. Die konkrete Umsetzung hier ist eine eigene, auf den Plotter zugeschnittene Planung.
