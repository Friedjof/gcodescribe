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

## Umsetzungsstand

Die Arbeit erfolgt auf `interface-refactoring`; `main` und der Sicherungstag bleiben unverändert.

- Shell, echte Arbeitsbereich-Tabs, Tab-Verwaltung und lokale Layout-Präferenzen sind implementiert.
- Der Designer besitzt optionale, verstellbare Seiten-/Eigenschaftenbereiche, weißes Papier, Lineale, eine feste Zoomleiste und einstellbaren Papierrand. Ansichtsänderungen schreiben keine Geometrie.
- Dokumentbefehle wurden in eine gemeinsame Menüleiste verschoben. Der Anfängermodus reduziert die ständig sichtbaren Werkzeuge; Spezialwerkzeuge bleiben erreichbar.
- Der Einrichtungsassistent führt durch Profil/Projekt, Verbindung, Papier/Stift, erste Textseite und echte G-Code-Vorschau. Fortschritt wird pro Projekt gespeichert und an die geprüfte Profilversion gebunden. Offline-Vorbereitung bleibt von vollständiger Maschineneinrichtung unterscheidbar.
- Die Anfänger-Kalibrierung verwendet dieselben Controller wie die vollständige Ansicht, zeigt aber jeweils einen Arbeitsschritt. Zusätzliche Positionen und Hindernisse stehen in einem optionalen Menü.
- Dialogfokus und Tastaturnavigation wurden abgesichert, damit Menünavigation keine Jog-Befehle auslöst.

Zwischenprüfung: 485 Frontend-Tests erfolgreich; produktiver Frontend-Build erfolgreich. Browserdurchläufe gegen einen lokalen Backend-Prozess mit separater Testdatenablage: vorhandenes Profil, Neuanlage eines Profils samt Projekt, Offline-Einstieg, erste Textseite und 3D-Wegvorschau. Kein Hardwarezugriff und kein Druckstart. Weitere Theme-, Layout-, Integrations- und Paketprüfungen folgen.

## Zusätzliche Nutzerkorrekturen vom 16.11.

- Oberfläche war noch zu unübersichtlich: Symbolleiste auf eine Zeile reduziert, Eigenschaften bei Bedarf und mehr einheitliche SVG-Symbole.
- Desktop hat Vorrang. Einrichten/Kalibrieren müssen ohne Scrollen erreichbar bleiben. Der doppelte Start-/Einrichtungsbereich entfällt; bestehende gespeicherte Start-Tabs werden migriert.
- Kopf kompakter und klassische Programmmenüs (Datei, Ansicht, Extras, Hilfe).
- Tab-Verwaltungsdialog vollständig prüfen; eine globale horizontale Flex-Regel hat Einleitung und Liste nebeneinander gedrückt. Dialogkörper jetzt standardmäßig vertikal, spezifische Mehrspalten-Dialoge definieren ihre Aufteilung ausdrücklich.
- Vorlagen grundlegend als Bibliothek links, Vorschau Mitte, paginierte Parameter rechts aufbauen. Erzeugen/Übernehmen bleiben sichtbar.
- Ausnahme für Scrollen: Die **Auftragsliste soll scrollen**; ihre Filter und Aktionen bleiben stehen. Beim Listen-/Kachelwechsel Vorschaudaten wiederverwenden und nur sichtbare Thumbnails laden.
- Aktueller Auftrag: alle Funktionen und Dialoge auf Formatierung, Funktion und Übersichtlichkeit prüfen. Hardwarebewegungen werden in der isolierten Browserprüfung nicht ausgeführt.

Browser-Zwischenbefund bei 1366×768: alle vier Kalibrierungsaufgaben und alle 14 Vorlagen ohne vertikalen/horizontalen Inhaltsüberlauf; Tab-Dialog vollständig im Fenster; 45 künstliche Jobs in einem eigenen Scrollbereich. Neue Vorlagenvorschau tatsächlich erzeugt. Vollständiger Frontend-Lauf derzeit 499 Tests erfolgreich. Weitere Funktions-/Dialogprüfung läuft.

### Inline maps and reproducible random templates

- Templates now use a paginated library, a full-height paper preview, and a bounded properties pane. Parameter pages preserve their values; creation actions remain visible.
- OSM lives directly in that workspace. Place search, layer selection and drawing parameters have their own property tabs. Map changes debounce by 250 ms, cancel superseded requests, retain the last visible drawing, and reuse up to six recent results. Insertion requires a result matching current settings. Full route/3D analysis runs only on explicit request.
- Random templates have a permanent, explained five-digit random code (including Bingo), an explicit dice action, and repeatable Generate behavior. Codes are preserved as object metadata and shown in the drawing status. The font writing test also exposes and explains its variant code.
- Validation: production build passed; 505 frontend tests passed before the final object-metadata regression was added. Inline OSM checked in Firefox at 1366 × 768 with mocked map data: no dialog and no overflowing pane, including all layers and drawing settings. Real OSM network latency is external and was not benchmarked by this fixture.

### Final desktop review

The desktop review now covers the nine available workspaces (drawing, templates, gallery, jobs, setup, profiles, control, font editor and AI designer), rather than only the start screen.

| Area | Result |
| --- | --- |
| Desktop layouts | Firefox: 54 workspace/theme/viewport combinations at 1024 × 768, 1366 × 768 and 1920 × 1080; no overflowing main panes or uncaught JavaScript errors in those checks. |
| Setup | New-profile form, connection, all four calibration tasks, first-page and preview tasks fit at 1024 and 1366 pixels. Connected control rendering used simulated GET responses; all writes/motion requests were blocked and none were attempted. |
| Templates / random code | All 14 templates checked. The same five-digit code reproduced identical preview paths, and code 54321 remained visible after creating a canvas page. Mandala and pattern styles now use named choices that fit the inspector. |
| OSM | Inline place/content/drawing tabs; matching-result insertion, cancellation and bounded cache tested. Local map fixtures were used; external OSM service latency remains outside this UI benchmark. |
| Jobs | Collection retains vertical scrolling. Six list/tile switches with 45 local test jobs reached the next painted view in 19–29 ms. Heavy path conversion is bounded/cached. Replaced or closed 3D previews cannot be reopened by late responses. |
| Other dialogs | All profile and settings groups, writing-test playback/alignment, font/symbol collections, project settings, STL parameter pages and gallery item details checked. Confirmation and text prompts now share modal focus and Escape ownership. |
| AI | Local fake generation → saved gallery item → detail view succeeded. No paid/external AI request was made. |
| Development | Polling-based Vite startup succeeded in 110 ms on a separate test port; HTML and current styles returned HTTP 200. The full interactive make launcher was not used because it may manage existing user services. |
| Automated checks | 516 frontend tests passed; 1019 Python tests passed after the captured-project fix; Ruff passed. Production build passed. Vite still reports its existing advisory for a main chunk larger than 500 kB. |

Template insertion now captures the target project and expected profile fingerprint. A parallel project switch cannot redirect the page, and a changed target profile is rejected. Creating a page in a different project also preserves the currently active project's page selection.

The retired generated-template dialog, duplicate manual/automatic seed wiring and 53 obsolete dialog/layout rules have been removed. Feature layouts and bounded collection components live in separate modules; no dependencies were added. Changes are saved as separate commits on `interface-refactoring`; the original main branch and the rollback tag remain available.

Physical serial/OctoPrint motion and installed DEB/Flatpak notification delivery were not exercised by these UI fixtures. Existing desktop-notification regression tests passed (7 tests, also part of the Python suite). This pass does not publish a new release or claim a real printer test.

### Guided tour, visual finish and fine drawing lines

- A replayable 11-step tour now highlights the actual profile, connection,
  calibration, first-page, preview, drawing and template controls. First-time
  setup offers it automatically; Help → Guided tour opens it later. Back, Next,
  minimize, resume and saved progress keep it optional. Tour completion does not
  certify machine setup: returning to setup restores the real pending task.
- The overlay yields to settings, dialogs and printer activity. Real actions
  underneath remain usable; locked calibration steps retain their prerequisites.
  Manually switching tabs minimizes the tour. Temporarily revealing a hidden
  workspace does not change the user's saved tab preferences.
- The editor has quieter nested borders, consistent menu/dialog elevation,
  subtle paper shadow, a teal studio accent and short transitions. Reduced-motion
  preferences disable the decorative movement. Desktop density is preserved.
- Drawing ink now stays at 0.9 CSS pixels through zooming, mirroring and unequal
  object scales. The grid also keeps a stable screen width. Drafts, live scenes
  and shared previews use the same display width. Large drawings switch from a
  bounded bitmap to exact vector detail before the bitmap would be enlarged.
  Source geometry, eraser edit radius, pen settings and generated G-code are
  independent of this display correction.

Validation: 528 frontend tests passed; the final production build passed. The
tour completed at 1024×768 and 1366×768 without overflowing panes or cards. An
additional dark/reduced-motion browser run used real clicks to confirm a profile,
open/close settings, switch tabs and resume; hidden-tab preferences survived and
no write/motion request was attempted. A dense 52,250-point drawing exercised
bitmap/vector switching at high zoom; saved source geometry stayed identical.
The 54 workspace/theme/viewport combinations were checked again with the new
visual styles: no overflowing main panes or uncaught JavaScript errors.
The previous Python/Ruff checks still apply because this pass changes only the
frontend. Physical printer and installed DEB/Flatpak checks remain outstanding.
