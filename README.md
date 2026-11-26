# RimTrace

Webapp-PoC (iPhone/Safari) für die **kontinuierliche Messung von Seiten- und Höhenschlag** beim Zentrieren eines MTB-Hinterrads. Die Kamera schaut tangential über den höchsten Punkt der Felge, dahinter liegt eine helle LED-Fläche. Im Bild ist die Felge eine dunkle Silhouette (U-Profil mit zwei Hörnern):

- Verschiebung links/rechts = Seitenschlag, oben/unten = Höhenschlag, beide relativ zu einer festen Referenzkante
- Maßstab: jedes Bild neu aus der bekannten Felgenaußenbreite (Selbstkalibrierung)
- Drehwinkel aus der Markerspur: eine Marke pro Speiche, Doppelmarke am Ventil als Nullpunkt, linear interpoliert
- Ergebnis: Profil je Speiche (Median über mehrere Umdrehungen) und Top-3-Maßnahmen

**Stand: Stufe 3.** Zwei Analysepfade: der synthetische (Generator mit Ground Truth, Markerspur) und ein zweiter für **echte Aufnahmen** (Felge von oben im Bild, Löcher als Speichentakt, Aufkleber als Nullpunkt). Eine Kamera ist noch nicht angebunden.

## Befehle

```sh
npm install
npm test          # synthetisch (ideal, kamera, handdrehung, zu-schnell) und echte Videos (real-0977, real-0975, nur wenn videos/IMG_*.MOV vorhanden)
npm run dev       # Web-Oberfläche auf http://localhost:5173
npm run build     # Typprüfung + Produktions-Build
```

## Aufbau

```
src/core/       reine Funktionen auf Graustufenbildern (Uint8Array + Breite/Höhe), ohne DOM
  edges.ts        Kanten mit Subpixel-Genauigkeit
  measure.ts      Seiten-/Höhenschlag relativ zur Referenzkante, mm über Felgenbreite
  marks.ts        Marken, Doppelmarke, Drehwinkel (PhaseTracker mit tooFast-Erkennung)
  aggregate.ts    Median je Speichenposition über mehrere Umdrehungen
  recommend.ts    Faustregel-Empfehlung, Top-3
  analyzer.ts     verbindet alles, Bild für Bild
  setup.ts        Felgen-/Bildgeometrie, parseSetup (JSON)
  silhouette.ts   Flanken, Hornspitzen, Oberkanten mit Subpixel-Genauigkeit (echte Aufnahmen)
  holes.ts        Loch- und Aufkleber-Erkennung aus der Helligkeit eines Fensters
  realSetup.ts    Setup für echte Aufnahmen (Pixel im Videobild)
  realAnalyzer.ts Auswertung echter Aufnahmen: Bild für Bild, danach Profil je Umdrehung
src/generator/  deterministischer Testvideo-Generator (Seed) mit Ground Truth je Bild
  render.ts       Szene mit wahrem Maßstab, analytische Gauß-Unschärfe
  noise.ts        normalverteiltes Bildrauschen (Seed)
  rotation.ts     Handdrehung: schwankende Geschwindigkeit, Stopps, Zurückdrehen (Seed)
src/app/        Web-Oberfläche (Canvas, Live-Werte, uPlot-Diagramme, Setup-Editor); FrameSource als Schnittstelle
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
- Pro Speiche und Umdrehung der Median der Bilder um das Loch (± `binHalfWidth` Lochabstand), zentriert; „Median alle“ über alle Umdrehungen. Die Top-3-Maßnahmen (Faustregel aus Stufe 1) beruhen auf „alle“.

**Bedienung:** `npm run dev`, „Auswertung: echte Aufnahme“ wählen, Videodatei laden (die Standardwerte passen zu `IMG_0977`). Das Setup-JSON darunter enthält alle Messbereiche in Videopixeln; das Overlay (Flankenzeilen, Hornspitzen, Referenz, Lochfenster) folgt der Eingabe live, gespeichert wird im `localStorage` (`rimtrace.realsetup.v1`). Teil-JSON ergänzt die Standardwerte, `spokes` (Standard 28) stellt die Speichenzahl ein. Eine Änderung von `crop` startet das Video neu, andere Änderungen werten ab dem nächsten Bild neu aus („Zurücksetzen“ startet von vorn). Für jedes Video braucht es eigene Messbereiche; Beispiele in `test/real/*.json`. Videos liegen in `videos/` (nicht eingecheckt); die `real-*`-Tests überspringen sich ohne Datei.

Grenzen: Messbereiche manuell; Rückwärtsdrehen wird nicht erkannt; die Felgenbreite von 27 mm ist noch nicht nachgemessen.

### Annahmen des Generators

- Wahrer Maßstab 0,0937 mm/px (einstellbar), Bild 1920×480 (Ausschnitt aus 1920×1080), Felge 27 mm breit, Hörner 5 mm hoch und 3 mm breit, Umfang 1750 mm, 32 Speichen (gerade = links). Die Pixelbereiche in `Setup` sind unabhängig vom Maßstab.
- Ground Truth je Achse: drei Sinusanteile (1.–3. Ordnung, je 0,4–1,0 mm Amplitude, Phasen aus dem Seed) plus lokale Ausreißer (u. a. Speiche 7 mit +0,8 mm seitlich) und eine eingeebnete Stelle im Höhenschlag.
- Seiten-/Höhenschlag werden mittelwertfrei verglichen, da der Abstand zur Referenzkante absolut nicht von Interesse ist.

## Stufenplan

1. ✅ Generator plus Auswertung `ideal`
2. ✅ Maßstab, Rauschen/Unschärfe, Handdrehung, Videodatei-Quelle
3. Machbarkeitstest mit echten Aufnahmen: Auswertung echter Videos in Kern und App ✅; offen: Kantenmessung mit Fühlerlehre, Abgleich der Absolutwerte ← **aktuell**
4. Optimierung anhand der echten Aufnahmen (Kantenerkennung, Störungen im Generator realistisch einstellen)
5. Zentrieren am echten Rad mit Halterung, Rechenmodell, Abgleich mit Messuhren

Ziel-Genauigkeit am Ende: ±0,2 mm.
