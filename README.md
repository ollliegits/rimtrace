# RimTrace

Webapp-PoC (iPhone/Safari) für die **kontinuierliche Messung von Seiten- und Höhenschlag** beim Zentrieren eines MTB-Hinterrads. Die Kamera schaut tangential über den höchsten Punkt der Felge, dahinter liegt eine helle LED-Fläche. Im Bild ist die Felge eine dunkle Silhouette (U-Profil mit zwei Hörnern):

- Verschiebung links/rechts = Seitenschlag, oben/unten = Höhenschlag, beide relativ zu einer festen Referenzkante
- Maßstab: jedes Bild neu aus der bekannten Felgenaußenbreite (Selbstkalibrierung)
- Drehwinkel aus der Markerspur: eine Marke pro Speiche, Doppelmarke am Ventil als Nullpunkt, linear interpoliert
- Ergebnis: Profil je Speiche (Median über mehrere Umdrehungen) und Top-3-Maßnahmen

**Stand: Stufe 2.** Es gibt noch kein echtes Rad und keine Kamera; alles läuft gegen einen deterministischen synthetischen Feed mit bekannter Ground Truth oder gegen eine Videodatei (z. B. das in der Oberfläche aufgenommene Testvideo).

## Befehle

```sh
npm install
npm test          # je Testfall (ideal, kamera, handdrehung, zu-schnell): Generator → Auswertung → Ground Truth (Fehlertabelle + Abnahme)
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
src/generator/  deterministischer Testvideo-Generator (Seed) mit Ground Truth je Bild
  render.ts       Szene mit wahrem Maßstab, analytische Gauß-Unschärfe
  noise.ts        normalverteiltes Bildrauschen (Seed)
  rotation.ts     Handdrehung: schwankende Geschwindigkeit, Stopps, Zurückdrehen (Seed)
src/app/        Web-Oberfläche (Canvas, Live-Werte, uPlot-Diagramme, Setup-Editor); FrameSource als Schnittstelle
test/           Vitest
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

### Annahmen des Generators

- Wahrer Maßstab 0,0937 mm/px (einstellbar), Bild 1920×480 (Ausschnitt aus 1920×1080), Felge 27 mm breit, Hörner 5 mm hoch und 3 mm breit, Umfang 1750 mm, 32 Speichen (gerade = links). Die Pixelbereiche in `Setup` sind unabhängig vom Maßstab.
- Ground Truth je Achse: drei Sinusanteile (1.–3. Ordnung, je 0,4–1,0 mm Amplitude, Phasen aus dem Seed) plus lokale Ausreißer (u. a. Speiche 7 mit +0,8 mm seitlich) und eine eingeebnete Stelle im Höhenschlag.
- Seiten-/Höhenschlag werden mittelwertfrei verglichen, da der Abstand zur Referenzkante absolut nicht von Interesse ist.

## Stufenplan

1. ✅ Generator plus Auswertung `ideal`
2. Maßstab, Rauschen/Unschärfe, Handdrehung, Videodatei-Quelle ← **aktuell**
3. Machbarkeitstest mit echten Aufnahmen: Kantenmessung mit Fühlerlehre, Drehwinkel-Erkennung am echten Rad
4. Optimierung anhand der echten Aufnahmen (Kantenerkennung, Störungen im Generator realistisch einstellen)
5. Zentrieren am echten Rad mit Halterung, Rechenmodell, Abgleich mit Messuhren

Ziel-Genauigkeit am Ende: ±0,2 mm.
