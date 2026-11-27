# Auftrag: RimTrace – Stufe 5: Geführte Einrichtung und Prüfung der Messbereiche

Stand: Commit `dd98b43` (Redesign) ist veröffentlicht. Anforderungen: `docs/anforderungen.md`. Diese Stufe setzt Nutzerfeedback aus dem ersten echten Test um. Keine Änderung an der eigentlichen Messlogik (Kantenmessung, Nummerierung, Maßnahmen), außer wo unten ausdrücklich genannt.

## Feedback des Nutzers
1. Nach dem Koppeln lässt sich zunächst **kein Standbild holen**. Erst muss man unter „Laufrad → Ändern …“ die Konfiguration öffnen und übertragen. Das ist nicht erkennbar.
2. Die Messrahmen sind schnell aufgezogen, aber **ob sie richtig sitzen, prüft niemand**. Eine schlecht eingerichtete erste Messung liefert nur wiederholt „ungenügend“, ohne Hinweis, woran es liegt. Gewünscht sind Hinweise wie „Kontrast zu schwach“, „keine Kontur gefunden“ oder „uneindeutige Erkennung“, und zwar **vor** der Messung.

## Ursache zu 1
`setLinkState('verbunden')` in `src/app/control.ts` sendet die Konfiguration nur, wenn `applyConfigSilently()` gelingt. Bei neuer Felge fehlt `rimWidthMm` (Pflichtfeld, kein Standardwert), deshalb wird nichts gesendet. Das Handy hat dann keine Konfiguration und kann kein Standbild liefern, die Oberfläche sagt aber nichts dazu.

## 1. Einrichtung als geführte Teilschritte (Steuerung)
Im Schritt „Einrichten“ eine kurze, sichtbare Checkliste mit Zustand je Punkt (offen / erledigt / Problem), jeweils mit der nächsten Aktion als primärem Knopf:
1. **Laufrad prüfen und an Kamera senden.** Ist die Konfiguration unvollständig (z. B. Felgenbreite fehlt), steht hier ein deutlicher Hinweis mit Knopf „Einstellungen öffnen“, der direkt zum fehlenden Feld springt. Erledigt erst nach `config-ok` vom Handy.
2. **Standbild holen.** Der Knopf ist gesperrt, solange Schritt 1 offen ist, und die Sperre wird begründet („Erst Laufrad-Konfiguration an die Kamera senden“).
3. **Messbereiche einrichten und prüfen** (siehe 2).
4. **Bereit zur Messung.** „Start“ wird erst hier prominent. Mit Problemen aus Schritt 3 bleibt Start möglich, zeigt aber vorher eine Bestätigung mit den offenen Problemen.

Ist die Konfiguration beim Verbinden bereits vollständig, wird sie wie bisher automatisch gesendet und Schritt 1 erscheint direkt als erledigt.

Prüfen, ob das Handy für ein Standbild wirklich eine Konfiguration braucht. Falls ja, im Bericht begründen. Falls nein, das Standbild auch ohne Konfiguration erlauben; die Checkliste bleibt trotzdem so.

## 2. Prüfung der Messbereiche („Einrichtungsprüfung“)
Neue Funktion im Kern (`src/core/setupProbe.ts`, rein, ohne DOM, testbar in Node). Sie bewertet für **ein Bild** (Graustufen, volle Auflösung, nicht das JPEG-Standbild) und die aktuellen Messbereiche jeden Bereich einzeln. Ergebnis je Bereich: Ampel (ok / Warnung / Fehler), ein Kurztext und ein Handlungshinweis, dazu die Messgrößen für die Diagnose.

| Bereich | Prüfungen (Beispiele, Schwellen als benannte Konstanten) |
|---|---|
| Felge / Flanken (gelb) | Hell-Dunkel-Kontrast zwischen Rand und Felge (z. B. < 60 Graustufen → „Kontrast zu schwach“). Anteil der Zeilen mit genau einem dunklen Bereich und zwei Kanten (< 80 % → „uneindeutige Erkennung: mehrere dunkle Bereiche“). Keine Kante gefunden → „keine Kontur gefunden“. Kante am Rahmenrand → „Felge berührt den Rand: Rahmen breiter ziehen“. Gemessene Breite in px plausibel zum Maßstab. |
| Hornspitzen / Unterkante | Unterkante gefunden; beide Spitzen innerhalb des Rahmens; Abstand zur Rahmenunterkante ausreichend für den Seitenschlag. |
| Referenz (grün) | Senkrechte Kante eindeutig (eine Kante bzw. ein schmales dunkles Objekt), Oberkante gefunden. Kontrast. Streuung der Kantenlage über die Zeilen klein (sonst „Referenz nicht gerade bzw. unscharf“). |
| Lochfenster / Bettstreifen (blau) | Liegt innerhalb der Felgensilhouette (nicht im Hintergrund). Ausreichende Helligkeitsreserve für Lochereignisse, also Basis nicht schon nahe Schwarz. Hinweis, falls das Fenster gerade auf einem Loch liegt („Rad etwas drehen und erneut prüfen“). |
| Ausschnitt | Alle Bereiche im Ausschnitt (vorhandene Prüfung `realSetupError` weiterverwenden). |

Ablauf:
- Neue Protokollnachrichten `probe-request` (Steuerung → Kamera) und `probe` (Kamera → Steuerung, Ergebnis je Bereich), versioniert und geprüft wie die übrigen Nachrichten.
- Die Kamera führt die Prüfung auf dem **aktuellen Live-Bild** im Worker aus. Die Steuerung fordert sie automatisch nach jedem Standbild und nach jeder Änderung eines Rahmens an (entprellt, ca. 300 ms), außerdem per Knopf „Einrichtung prüfen“.
- **Anzeige am Standbild:** Rahmenfarbe bzw. Rahmen mit Ampel-Symbol (✓ / ! / ✕, nicht nur über Farbe), dazu die erkannten Kanten, Hornspitzen und die Referenz als Overlay, damit sichtbar ist, *was* erkannt wurde. Darunter eine Liste der Probleme mit Handlungshinweis.
- **Optionale Probedrehung** (empfohlen, wenn mit vertretbarem Aufwand machbar): Knopf „Probedrehung (eine Runde)“. Kurzer Messlauf ohne Ergebnis, der nur Lochereignisse zählt und Kontrast und Ereignistiefe meldet, z. B. „27 von 28 Löchern erkannt“ oder „Ventilloch nicht eindeutig“. Ist das zu aufwendig, im Bericht begründen und weglassen.
- Die vorhandenen Fehlertexte nach einer Messung (`hints` in `control.ts`) verweisen künftig auf den konkreten Bereich und die Prüfung, z. B. „Siehe Einrichtungsprüfung: Felge – Kontrast zu schwach“.

## Tests (Pflicht)
- `setupProbe` mit synthetischen Bildern: gut eingerichtet → alles ok; zu geringer Kontrast; Rahmen ohne Felge; zwei dunkle Objekte im Flankenrahmen; Felge am Rahmenrand; Referenz fehlt; Lochfenster im Hintergrund.
- Mit echten Bildern aus `videos/IMG_0977.MOV` (überspringen, wenn die Datei fehlt): korrektes Setup aus `test/real/IMG_0977.json` → alles ok; absichtlich verschobene Rahmen → die erwarteten Fehler.
- Protokoll: `probe-request` und `probe` gültig bzw. ungültig.
- Alle bisherigen Tests grün, `npm run build` ohne Fehler.

## Oberfläche prüfen
Im Browser mit der Entwickler- bzw. Fake-Kamera (wie in Stufe 4) durchklicken: Koppeln → Checkliste zeigt „Laufrad senden“ als nächsten Schritt → Standbild → Ampeln. Rahmen absichtlich falsch ziehen, die Meldungen müssen verständlich sein. Screenshots unter `/Users/A319043/.copilot/session-state/167bc02d-ab44-4674-8390-627c04bfbd1e/files/ux/stufe5-*.png` (nicht ins Repo). Stil wie bisher (bike-geometry).

## Nicht in Stufe 5
- Automatisches Finden der Messbereiche
- D2, D3, D5 (Issues #1–#3)
- Phasenlogik (Z1)

## Abschluss
README (Abschnitt Oberfläche/Einrichtung) knapp ergänzen. Ein Commit mit Trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` und anschließend `git push origin main` (veröffentlicht automatisch auf GitHub Pages; den Lauf des Workflows prüfen).

Bericht: umgesetzte Prüfungen mit Schwellen, Testergebnis, Screenshots, ob die Probedrehung umgesetzt wurde, offene Punkte.
