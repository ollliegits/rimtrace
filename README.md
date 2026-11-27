# RimTrace

Webapp-PoC (iPhone/Safari) für die **kontinuierliche Messung von Seiten- und Höhenschlag** beim Zentrieren eines MTB-Hinterrads. Die Kamera schaut tangential über den höchsten Punkt der Felge, dahinter liegt eine helle LED-Fläche. Im Bild ist die Felge eine dunkle Silhouette (U-Profil mit zwei Hörnern):

- Verschiebung links/rechts = Seitenschlag, oben/unten = Höhenschlag, beide relativ zu einer festen Referenzkante
- Maßstab: jedes Bild neu aus der bekannten Felgenaußenbreite (Selbstkalibrierung)
- Drehwinkel aus der Markerspur: eine Marke pro Speiche, Doppelmarke am Ventil als Nullpunkt, linear interpoliert
- Ergebnis: Profil je Speiche (Median über mehrere Umdrehungen) und Maßnahmen

**Stand: Stufe 4 (MVP).** Zwei Analysepfade: der synthetische (Generator mit Ground Truth, Markerspur) und der für **echte Aufnahmen** (Felge von oben im Bild, Löcher als Speichentakt, Ventilloch bzw. Aufkleber als Nullpunkt). Neu: Live-Messung mit der iPhone-Kamera (Web Worker), Kopplung Handy ↔ Notebook per WebRTC mit QR-Codes ohne Vermittlungsserver, Steuerung am Notebook.

## Befehle

```sh
npm install
npm test          # synthetisch (ideal, kamera, handdrehung, zu-schnell) und echte Videos (real-0977, real-0975, nur wenn videos/IMG_*.MOV vorhanden)
npm run dev       # Web-Oberfläche auf http://localhost:5173
npm run dev:https # HTTPS mit selbstsigniertem Zertifikat, im WLAN erreichbar (--host), für das iPhone
npm run build     # Typprüfung + Produktions-Build (BASE_PATH=/unterpfad/ setzt `base`, Standard ./)
```

Seiten: `index.html` (Rollenwahl), `control.html` (Steuerung, Notebook), `camera.html` (Kamera, iPhone), `dev.html` (Entwicklerseite: Generator, Videodatei).

## Aufbau

```
src/core/       reine Funktionen auf Graustufenbildern (Uint8Array + Breite/Höhe), ohne DOM
  edges.ts        Kanten mit Subpixel-Genauigkeit
  measure.ts      Seiten-/Höhenschlag relativ zur Referenzkante, mm über Felgenbreite
  marks.ts        Marken, Doppelmarke, Drehwinkel (PhaseTracker mit tooFast-Erkennung)
  aggregate.ts    Median je Speichenposition über mehrere Umdrehungen
  recommend.ts    Faustregel-Empfehlung (Stufe 1, Generator/Dev-Seite)
  truing.ts       Einflussmodell + kleinste Fehlerquadrate: Drehung je Speiche, auch für breite Auslenkungen
  analyzer.ts     verbindet alles, Bild für Bild
  setup.ts        Felgen-/Bildgeometrie, parseSetup (JSON)
  silhouette.ts   Flanken, Hornspitzen, Oberkanten mit Subpixel-Genauigkeit (echte Aufnahmen)
  holes.ts        Loch- und Aufkleber-Erkennung aus der Helligkeit eines Fensters
  realSetup.ts    Setup für echte Aufnahmen (Pixel im Videobild)
  realAnalyzer.ts Auswertung echter Aufnahmen: Bild für Bild, danach Profil je Umdrehung, Prüfung (`result()`)
  bedShift.ts     Verschiebung des Felgenbetts zwischen zwei Bildern (Drehrichtung)
  numbering.ts    Nummerierung 1…N ab Nullpunkt, Nettozählung mit Richtung
  orientation.ts  Bild drehen/spiegeln (Canvas-Matrix und CPU-Variante)
  session.ts      Messsitzung (Bilder, Rechenzeit, Status) für den Worker
  protocol.ts     Nachrichten Handy ↔ Notebook, Prüfung, Standbild in Teilen
  sdp.ts          SDP auf einen kurzen Code (ca. 100 Zeichen) verkleinern und wiederherstellen
src/generator/  deterministischer Testvideo-Generator (Seed) mit Ground Truth je Bild
  render.ts       Szene mit wahrem Maßstab, analytische Gauß-Unschärfe
  noise.ts        normalverteiltes Bildrauschen (Seed)
  rotation.ts     Handdrehung: schwankende Geschwindigkeit, Stopps, Zurückdrehen (Seed)
src/app/        Web-Oberfläche; FrameSource als Schnittstelle
  control.ts      Steuerung: Kopplung, Konfiguration, Standbild mit Overlay, Start/Stopp, Ergebnis
  camera.ts       Kamera-Rolle: CameraSource, Worker, Kopplung, Diagnoseanzeige
  analysis.worker.ts Auswertung im Web Worker; cameraSource.ts getUserMedia → Graustufen-Ausschnitt
  rtc/            link.ts (RTCPeerConnection ohne ICE-Server, Datenkanal), qr.ts (QR zeichnen/scannen)
  main.ts         Entwicklerseite (Canvas, Live-Werte, Setup-Editor)
test/           Vitest; support/videoReader.ts liest Videos in Node über ffmpeg-static, real/*.json ist das Setup je Video
```

`FrameSource` (`src/app/frameSource.ts`) ist die austauschbare Bildquelle. Implementiert: `GeneratorSource` und `VideoFileSource` (`<video>` → Canvas → Graustufen, jedes dargestellte Bild einmal, Pause/Neustart). Die Kamera (`getUserMedia`) implementiert später dieselbe Schnittstelle.

### Testfälle

| Testfall | Störungen |
|---|---|
| `ideal` | gleichmäßige Drehung, kein Rauschen |
| `kamera` | Rauschen σ = 4 Graustufen, Unschärfe σ = 1,5 px |
| `handdrehung` | `kamera` + Handdrehung (schwankende Geschwindigkeit, Stopps 0,5–2 s, Zurückdrehen bis ½ Speiche) |
| `zu-schnell` | `handdrehung` + drei Abschnitte mit 24 Speichen/s (0,8 Speichen/Bild) |

Alle Testfälle rendern mit dem wahren Maßstab 0,0937 mm/px. Die Auswertung kennt ihn nicht, sie misst ihn je Bild über die Felgenbreite. Glanzlicht, Wackeln, Maßstabsdrift und fehlende Marke sind nur als Einstellung vorhanden; der Generator lehnt sie ab.

### Drehwinkel und `tooFast`

Die Winkelverfolgung setzt voraus, dass sich das Rad zwischen zwei Bildern um weniger als ½ Speiche dreht. Ein Schritt über 0,4 Speichen setzt `tooFast`: das Bild wird verworfen, die Position gilt als verloren und wird erst durch die nächste Doppelmarke wieder verankert (frühestens 30 Bilder nach der letzten Meldung). Die Oberfläche zeigt die Warnung an.

Grenze: Schritte über ½ Speiche/Bild sind von einem kleinen Rückwärtsschritt nicht zu unterscheiden. Erkannt wird nur das Durchlaufen der Rampe (0,4–0,6 Speichen/Bild), nicht eine dauerhaft zu schnelle Drehung.

### Videodatei und Setup

In der Oberfläche eine Videodatei wählen oder mit „Testvideo aufnehmen“ den gewählten Testfall 15 s in Echtzeit per `MediaRecorder` aufnehmen (wird danach automatisch geladen, „Video speichern“ legt eine Datei ab; nicht eingecheckt). Die Pixelbereiche (`Setup`: Flankenzeilen, Referenzkante, Hornspalten, Markerspur, Lesestelle) lassen sich bei Videoquellen als JSON editieren, das Overlay folgt live, gespeichert wird im `localStorage` (`rimtrace.setup.v1`). Teil-JSON ergänzt die Standardwerte. Ground Truth ist bei Videodateien optional; ohne sie zeigen die Diagramme nur den Messwert.

### Echte Aufnahmen (Stufe 3)

Aufbau der Aufnahme: Hochformat, Felge hängt von oben ins Bild, helle Fläche dahinter, rechts daneben eine Referenzspeiche (Nippelkopf) oder ein Referenzblock. Ausgewertet wird nur der Bildausschnitt `crop`.

- Seitenschlag = Felgenmitte (aus den Flanken) minus Referenz, Höhenschlag = mittlere Hornspitze minus Oberkante der Referenz; Maßstab = bekannte Felgenbreite / gemessene Breite (Median über das ganze Video).
- Drehposition: Das Fenster `holeWindow` oberhalb der Hornspitzen liegt in der Felgenmitte; jedes Speichenloch (Helligkeitseinbruch) ist ein Takt, der helle Aufkleber der Nullpunkt (Loch 0 = erstes Loch danach). Löcher vor dem ersten Aufkleber werden rückwärts nummeriert (Umdrehung 0, nur Teil).
- Pro Speiche und Umdrehung der Median der Bilder um das Loch (± `binHalfWidth` Lochabstand), zentriert; „Median alle“ über alle Umdrehungen. Die Maßnahmen beruhen auf „alle“ (nur volle Umdrehungen).

**Maßnahmen (`src/core/truing.ts`):** Eine Nippeldrehung wirkt als Glocke (σ = 2 Speichen) auf die Nachbarspeichen; seitlich zur Flanschseite der Speiche, in der Höhe zur Nabe. Aus Seiten- und Höhenschlag (Bezug: Median) werden die Drehungen aller Speichen per regularisierter kleinster Quadrate berechnet (je auf die Toleranz bezogen), mit 60 % angesetzt, auf ⅛ gerundet, höchstens ½ je Speiche, Drehungen unter 0,1 weggelassen. Breite Auslenkungen ergeben so viele kleine Drehungen im Verbund, schmale wenige größere. Angezeigt werden außerdem die Breite der Auslenkung und die erwartete Restabweichung. **Die Modellwerte (1 mm/Umdr. seitlich, 0,5 mm/Umdr. Höhe, σ) sind Annahmen** (Größenordnung aus US 5 103 414) und noch nicht am echten Rad kalibriert; nach jedem Durchgang neu messen.

**Bedienung:** `npm run dev`, „Auswertung: echte Aufnahme“ wählen, Videodatei laden (die Standardwerte passen zu `IMG_0977`, dazu `rimWidthMm` eintragen). Das Setup-JSON darunter enthält alle Messbereiche in Videopixeln; das Overlay (Flankenzeilen, Hornspitzen, Referenz, Lochfenster) folgt der Eingabe live, gespeichert wird im `localStorage` (`rimtrace.realsetup.v1`). Teil-JSON ergänzt die Standardwerte (außer `rimWidthMm`, das immer eingetragen werden muss; solange es fehlt, wird nicht ausgewertet), `spokes` (Standard 28) stellt die Speichenzahl ein. Eine Änderung von `crop` startet das Video neu, andere Änderungen werten ab dem nächsten Bild neu aus („Zurücksetzen“ startet von vorn). Für jedes Video braucht es eigene Messbereiche; Beispiele in `test/real/*.json`. Videos liegen in `videos/` (nicht eingecheckt); die `real-*`-Tests überspringen sich ohne Datei.

Grenzen: Messbereiche manuell (JSON, mit Standbild-Overlay); die Felgenbreite `rimWidthMm` bestimmt den Maßstab und damit alle mm-Werte; sie ist ein Pflichtfeld ohne Standardwert (Testvideos: 27,5 mm, mit dem Messschieber gemessen, in `test/real/*.json`; dort steht auch `marker`: `aufkleber` für IMG_0977/0975, `ventil` für `ventil_01`).

### Live-Messung und Kopplung (Stufe 4)

Das Handy wertet aus (Kamera → Ausschnitt in Graustufen → Worker) und sendet nur Status, Standbild und Ergebnis. Das Notebook konfiguriert und zeigt an. Der Datenkanal (WebRTC) wird ohne Server aufgebaut: Die Steuerung zeigt das Offer als QR-Code (ca. 100 Zeichen, QR-Version 6), das Handy scannt es und zeigt die Antwort als QR-Code, die die Notebook-Webcam liest. Beide Codes lassen sich auch als Text einfügen. Beide Geräte müssen im selben WLAN sein (keine Geräteisolation/Gästenetz). Die Webcam wird vor dem Offer freigegeben, weil der Browser sonst die lokale Adresse hinter einem `.local`-Namen versteckt.

- **Nullpunkt:** Ventilloch (Dunkelereignis, größer als `valveRatio` × mittleres Loch; Standard 2) oder heller Aufkleber (`marker: "aufkleber"`, für die alten Testvideos). Speiche 1 ist die erste Speiche nach dem Nullpunkt in Fahrtrichtung; `spoke1Side` legt ihre Seite fest, `driveImageSide` die Antriebsseite im Bild.
- **Drehrichtung** aus der Verschiebung des Felgenbetts im Streifen `bedX`/`bedY` (Videokoordinaten); `travel` sagt, in welche Richtung sich das Bett bei Vorwärtsdrehen bewegt. Rückwärtsdrehen zählt netto.
- **Prüfung** des Ergebnisses: mindestens 2 volle Umdrehungen mit je N Löchern, Übereinstimmung der Umdrehungen (`agreeMeanMm`, `agreeMaxMm`), keine zu schnelle Drehung.
- **Bild drehen/spiegeln** in der Konfiguration (`rotate`, `mirror`), damit die Felge von oben ins Bild hängt; Messbereiche gelten im gedrehten Bild.
- Gespeichert wird im `localStorage` der Steuerung: Konfiguration (`rimtrace.control.v1`), letztes Ergebnis (`rimtrace.result.v1`). Die Kamera sendet nach einer Neukopplung ihr letztes Ergebnis erneut.

**HTTPS am iPhone:** `npm run dev:https`, am Notebook `https://<IP>:5173` (Adresse steht in der Konsole), am iPhone dieselbe Adresse. Das Zertifikat ist selbstsigniert: Safari warnt, „Details“ → „Diese Website besuchen“ bestätigen. Die Kamera-Freigabe verlangt HTTPS. Alternativ GitHub Pages (getestet): `.github/workflows/pages.yml` baut mit `BASE_PATH=/<Repository>/`, Pages-Source „GitHub Actions“; `https://<Nutzer>.github.io/<Repository>/control.html` am Notebook, `camera.html` am Handy.

**Fehlersuche Kopplung:** Die Zeile „ICE“ in der Tabelle beider Seiten zeigt den Zustand und die Adressen beider Seiten. Bekannte Ursachen: Firewall am Notebook mit „Alle eingehenden Verbindungen blockieren“ (blockiert UDP vom Handy); iPhone-Hotspot als Netz ungeeignet (Safari bietet nur Mobilfunk-Adressen an, nicht `172.20.10.1`); WLAN mit Geräteisolation. Mit normalem WLAN und ohne diese Firewall-Einstellung verband es direkt.

**Auswertung:** Nur volle Umdrehungen (alle Löcher gezählt) fließen ein; der Anlauf vor dem Nullpunkt und die angefangene letzte Umdrehung werden ignoriert.

**Stromversorgung:** Das Handy muss während der Messung am Ladegerät hängen. Kamera und Auswertung verbrauchen viel Strom, und der Bildschirm kann sich abschalten, wenn der Akku spart.

**Testcheckliste (iPhone ↔ Notebook):**

1. `npm run dev:https` am Notebook, `control.html` öffnen, Webcam freigeben, „Kopplung starten“.
2. Am iPhone `camera.html` öffnen (Zertifikatswarnung bestätigen), „Kamera starten“, Kamera freigeben, „QR-Code scannen“ und den Offer-QR vom Notebook-Bildschirm lesen. Gelingt das Scannen nicht, den Code aus dem Textfeld einfügen.
3. Den Antwort-QR vom iPhone-Bildschirm vor die Notebook-Webcam halten (oder Text einfügen). Beide Seiten zeigen „verbunden“. Notieren: Kandidatenpaar (Diagnose) und ob QR-Scan funktionierte.
4. In der Steuerung Felgenbreite (mm), Speichenzahl, Nullpunkt, Seiten eintragen und „Übernehmen und senden“.
5. „Standbild vom Handy holen“: Das Bild erscheint mit Overlay; Messbereiche im JSON anpassen, bis sie passen.
6. Start, Rad mindestens 2 volle Runden in Fahrtrichtung drehen, Stopp. Ein Ergebnisdiagramm 1…N mit je einer Kurve pro Umdrehung, die Prüfung und die Maßnahmen erscheinen.
7. Diagnose am Handy ablesen: Auflösung und Bildrate laut `getSettings()`, gemessene Bildrate, Rechenzeit Mittel/p95, verworfene Bilder, Lochzustand, QR-Version.

### Annahmen des Generators

- Wahrer Maßstab 0,0937 mm/px (einstellbar), Bild 1920×480 (Ausschnitt aus 1920×1080), Felge 27 mm breit, Hörner 5 mm hoch und 3 mm breit, Umfang 1750 mm, 32 Speichen (gerade = links). Die Pixelbereiche in `Setup` sind unabhängig vom Maßstab.
- Ground Truth je Achse: drei Sinusanteile (1.–3. Ordnung, je 0,4–1,0 mm Amplitude, Phasen aus dem Seed) plus lokale Ausreißer (u. a. Speiche 7 mit +0,8 mm seitlich) und eine eingeebnete Stelle im Höhenschlag.
- Seiten-/Höhenschlag werden mittelwertfrei verglichen, da der Abstand zur Referenzkante absolut nicht von Interesse ist.

## Stufenplan

1. ✅ Generator plus Auswertung `ideal`
2. ✅ Maßstab, Rauschen/Unschärfe, Handdrehung, Videodatei-Quelle
3. ✅ Machbarkeitstest mit echten Aufnahmen: Auswertung echter Videos in Kern und App; offen: Kantenmessung mit Fühlerlehre, Abgleich der Absolutwerte
4. MVP Stufe 4: Live-Kamera, Worker, Kopplung per QR/WebRTC, Steuerung am Notebook, Ventilloch, Nummerierung, Drehrichtung ← **aktuell** (Test am iPhone offen)
5. Optimierung anhand der echten Aufnahmen (Kantenerkennung, Störungen im Generator realistisch einstellen)
6. Zentrieren am echten Rad mit Halterung, Rechenmodell, Abgleich mit Messuhren

Ziel-Genauigkeit am Ende: ±0,2 mm.
