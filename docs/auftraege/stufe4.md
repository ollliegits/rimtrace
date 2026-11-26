# Auftrag: RimTrace – MVP Stufe 4: Live-Messung auf dem iPhone und Kopplung per QR-Code

Stufe 1–3 sind abgenommen (bis Commit `7cc4e15`). Die Anforderungen an die Anwendung stehen in `docs/anforderungen.md` (Commit `53ee838`). **Bitte zuerst lesen**, die IDs (G1, V3, K5 …) beziehen sich darauf.

Diese Stufe greift bewusst die **zwei größten technischen Risiken** zuerst an. Anweisungslogik, Phasen und lernender Faktor kommen erst danach.
1. Funktioniert die Messung **live im Safari auf dem iPhone** schnell genug?
2. Funktioniert die **direkte Kopplung Handy ↔ Notebook per WebRTC mit QR-Codes**, ohne Vermittlungsserver?

Ich (der Nutzer) teste auf echtem iPhone und Notebook. Du kannst das nicht selbst, deshalb muss die App **Diagnosewerte sichtbar anzeigen**, die ich zurückmelden kann.

## 1. Kamera als Datenquelle (G1, K6)
- `CameraSource` implementiert `FrameSource`: `getUserMedia` mit Rückkamera, Wunsch 1920×1080 und 60 fps (`frameRate: { ideal: 60 }`), Einzelbilder über `requestVideoFrameCallback` (Fallback `requestAnimationFrame`).
- Nur die Messbereiche aus dem Canvas lesen, nicht das ganze Bild.
- Die Auswertung läuft in einem **Web Worker**. Bilddaten als übertragbare Puffer übergeben, nicht kopieren.
- Kamera-Orientierung (Hoch-/Querformat, gespiegelt) ist einstellbar.
- **Diagnoseanzeige am Handy (Pflicht):** tatsächliche Auflösung und Bildrate laut `getSettings()`, gemessene Bilder pro Sekunde, Rechenzeit pro Bild (Mittel und 95-%-Wert), verworfene Bilder, Zustand der Lochzählung.
- Bildschirm wach halten (Wake Lock).

## 2. Live-Auswertung
- `RealAnalyzer` muss **Bild für Bild** arbeiten können (Streaming). Der Maßstab wird am Ende des Messlaufs bestimmt (Median der Breite), die Aufteilung in Umdrehungen erfolgt **nach dem Stopp** (M2, M6). Ein automatischer Stopp (M5) gehört **nicht** in diese Stufe.
- **Pflichttest:** IMG_0977 Bild für Bild durch den Streaming-Pfad geschickt ergibt dasselbe Profil wie der bisherige Pfad (Abweichung pro Speiche < 0,01 mm). Wie bisher überspringen, wenn das Video fehlt.

## 3. Ventilloch als Nullpunkt und Nummerierung (K3, K4, N1–N3, M3, M4)
- Nullpunkt-Marker konfigurierbar: `ventil` (Standard) oder `aufkleber` (für die vorhandenen Testvideos).
- `ventil`: Das Ventilloch ist größer als ein Nippelloch. Unterscheidung über Dauer und/oder Tiefe des Dunkelereignisses im Lochfenster, relativ zu den Nippellöchern derselben Umdrehung. Optional heller Punkt auf dem Ventilloch (ein hell/dunkel-Muster in einem Ereignis).
- **Speiche 1** = erste Speiche nach dem Ventil in Fahrtrichtung, durchgehend 1…N. Ob Speiche 1 zur Antriebsseite oder zur Bremsscheibenseite geht, ist einstellbar. Die Seiten heißen in der Oberfläche **Antriebsseite / Bremsscheibenseite**, nicht links/rechts.
- Die **Fahrtrichtung im Bild** ist eine Einstellung (Felgenbett läuft im Bild nach oben oder nach unten), weil sie vom Kameraaufbau abhängt.
- **Drehrichtung erkennen (M4):** über die Verschiebung des Felgenbetts zwischen zwei Bildern (1D-Kreuzkorrelation im Bettstreifen). Löcher beim Rückwärtsdrehen werden abgezogen statt gezählt.
- Ein Testvideo mit Ventilloch gibt es noch nicht. Ich nehme es auf und lege es als `videos/ventil_01.MOV` ab. Bis dahin: Logik mit synthetischen Ereignisfolgen testen, Video-Test vorbereiten und überspringen, wenn die Datei fehlt.

## 4. Kopplung per WebRTC und QR-Code (V1–V3, V5)
- Rollen: **Steuerung** (Notebook) und **Kamera** (Handy), auswählbar auf der Startseite.
- Ablauf ohne Vermittlungsserver:
  1. Die Steuerung erzeugt ein Offer mit DataChannel, wartet auf das Ende der ICE-Sammlung (kein Trickle) und zeigt es als QR-Code.
  2. Das Handy scannt den QR-Code mit der Kamera, erzeugt die Answer und zeigt sie als QR-Code.
  3. Die Steuerung scannt diesen QR-Code mit der Webcam.
- SDP **verkleinern**, damit der QR-Code gut scannbar bleibt: nur nötige Zeilen, komprimiert (z. B. `CompressionStream` deflate plus Base64). Ziel: QR-Version ≤ 15. Die Größe in Bytes anzeigen.
- Kein STUN/TURN nötig (gleiches WLAN). **Bekanntes Risiko:** iOS und Chrome verbergen lokale IP-Adressen hinter mDNS-Namen (`.local`). Bitte prüfen und im Bericht einschätzen, ob das zwischen iPhone und Mac bzw. Windows-Notebook auflösbar ist. Den Verbindungszustand und die gewählten Kandidaten sichtbar anzeigen.
- QR lesen mit `jsQR`, QR erzeugen mit einer kleinen Bibliothek. Kein Fremdserver.
- Bei Verbindungsabbruch deutliche Anzeige auf beiden Seiten. Erneutes Koppeln ist möglich, ohne dass am Notebook Konfiguration oder letzte Messung verloren gehen (V5).
- Rückfallebene V4 (lokaler Server) **nicht** umsetzen, nur im Bericht bewerten, falls V3 problematisch erscheint.

## 5. Protokoll und Notebook-Oberfläche (G2, G3, K1–K7, D1)
- Kleines, versioniertes JSON-Protokoll über den DataChannel:
  - `config`: Steuerung → Kamera
  - `snapshot`: Standbild auf Anfrage, JPEG verkleinert, in Teilen übertragen
  - `start` / `stop`
  - `status`: Kamera → Steuerung, ca. 2× pro Sekunde, mit Bildrate, Rechenzeit, Lochzahl, Warnungen
  - `result`: Profil pro Umdrehung und gesamt, Maßstab, Prüfergebnis (M7)
- Typen und Protokollprüfung im Kern, testbar in Node.
- **Notebook:**
  - Konfigurationsdialog mit Speichenzahl, Felgenbreite (Pflicht), Nullpunkt-Marker, Seite von Speiche 1, Fahrtrichtung im Bild, Orientierung, Toleranz
  - Standbild vom Handy anfordern und anzeigen, mit Overlay der Messbereiche. Die Bereiche werden in dieser Stufe noch per JSON eingestellt, das **interaktive Aufziehen (K5) folgt in der nächsten Stufe**.
  - Start / Stopp und Live-Status
  - Ergebnis als Liniendiagramm über Speiche 1…N, eine Kurve pro Umdrehung
- **Handy:** nur Kamera-Rolle mit Diagnoseanzeige, keine Bedienung außer der Kopplung.
- Die bisherige Oberfläche (Generator, Videodatei) bleibt als Entwicklerseite erreichbar.

## 6. Bereitstellung für meinen Test
- Das Repository hat **noch kein Remote**. Bitte:
  - `npm run dev:https`: Vite mit HTTPS (z. B. `@vitejs/plugin-basic-ssl`) und `--host`, damit das iPhone im WLAN zugreifen kann. Kurzanleitung in der README, inklusive Zertifikatswarnung.
  - einen GitHub-Actions-Workflow für GitHub Pages vorbereiten (`base` konfigurierbar). Er wird erst aktiv, wenn ich ein Remote anlege.

## Abnahme
Automatisch (`npm test`):
- Alle bisherigen Tests grün.
- Streaming- und bisheriger Pfad liefern für IMG_0977 dasselbe Profil.
- SDP verkleinern und wiederherstellen ergibt eine funktionsfähige SDP; Testfälle mit typischen SDPs von Chrome und Safari.
- Protokoll: Nachrichten gültig bzw. ungültig erkannt, Standbild in Teilen korrekt zusammengesetzt.
- Ventil-Erkennung, Nummerierung (Speiche 1 nach dem Ventil, Fahrtrichtung, Seite) und Rückwärtsdrehen mit synthetischen Ereignisfolgen.
- Felgenbreite fehlt → keine Messung möglich.

Manuell (ich führe das aus, du lieferst eine **Testcheckliste** in der README):
- Kopplung iPhone ↔ Notebook per QR-Code gelingt.
- Standbild kommt am Notebook an.
- Messlauf über 2 Runden liefert ein Profil am Notebook.
- Diagnosewerte (Bildrate, Rechenzeit) werden angezeigt.

`npm run build` ohne Fehler. Am Ende ein Commit (ohne Videos).

## Nicht in Stufe 4
- Anweisungslogik nach Phasen (Z1–Z8), lernender Faktor (L*), Laufrad-Profile (K10)
- automatischer Stopp (M5), interaktives Aufziehen der Messbereiche (K5)
- Rückfallebene V4, Optimierung mit WebGL/WebGPU

## Bericht
Melde am Ende:
- Ergebnis gegen die automatische Abnahme
- Einschätzung der Risiken: mDNS, QR-Größe, Rechenzeit pro Bild am Desktop als Anhaltspunkt
- offene Punkte
- was ich beim iPhone-Test konkret ablesen und zurückmelden soll
