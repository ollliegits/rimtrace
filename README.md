# RimTrace

Webapp-PoC (iPhone/Safari) für die **kontinuierliche Messung von Seiten- und Höhenschlag** beim Zentrieren eines MTB-Hinterrads. Die Kamera schaut tangential über den höchsten Punkt der Felge, dahinter liegt eine helle LED-Fläche. Im Bild ist die Felge eine dunkle Silhouette (U-Profil mit zwei Hörnern):

- Verschiebung links/rechts = Seitenschlag, oben/unten = Höhenschlag, beide relativ zu einer festen Referenzkante
- Maßstab: jedes Bild neu aus der bekannten Felgenaußenbreite (Selbstkalibrierung)
- Drehwinkel aus der Markerspur: eine Marke pro Speiche, Doppelmarke am Ventil als Nullpunkt, linear interpoliert
- Ergebnis: Profil je Speiche (Median über mehrere Umdrehungen) und Top-3-Maßnahmen

**Stand: Stufe 1.** Es gibt kein echtes Rad und keine Kamera; alles läuft gegen einen deterministischen synthetischen Feed mit bekannter Ground Truth.

## Befehle

```sh
npm install
npm test          # Generator → Auswertung → Vergleich mit Ground Truth (Tabelle + Abnahme)
npm run dev       # Web-Oberfläche auf http://localhost:5173
npm run build     # Typprüfung + Produktions-Build
```

## Aufbau

```
src/core/       reine Funktionen auf Graustufenbildern (Uint8Array + Breite/Höhe), ohne DOM
  edges.ts        Kanten mit Subpixel-Genauigkeit
  measure.ts      Seiten-/Höhenschlag relativ zur Referenzkante, mm über Felgenbreite
  marks.ts        Marken, Doppelmarke, Drehwinkel (PhaseTracker)
  aggregate.ts    Median je Speichenposition über mehrere Umdrehungen
  recommend.ts    Faustregel-Empfehlung, Top-3
  analyzer.ts     verbindet alles, Bild für Bild
  setup.ts        Felgen-/Bildgeometrie
src/generator/  deterministischer Testvideo-Generator (Seed) mit Ground Truth je Bild
src/app/        Web-Oberfläche (Canvas, Live-Werte, uPlot-Diagramme); FrameSource als Schnittstelle
test/           Vitest
```

`FrameSource` (`src/app/frameSource.ts`) ist die austauschbare Bildquelle. Aktuell: `GeneratorSource`. Videodatei und Kamera (`getUserMedia`) implementieren später dieselbe Schnittstelle.

### Annahmen des Generators

- 0,1 mm/px, Bild 1920×480 (Ausschnitt aus 1920×1080), Felge 27 mm breit, Hörner 5 mm hoch und 3 mm breit, Umfang 1750 mm, 32 Speichen (gerade = links).
- Ground Truth je Achse: drei Sinusanteile (1.–3. Ordnung, je 0,4–1,0 mm Amplitude, Phasen aus dem Seed) plus lokale Ausreißer (u. a. Speiche 7 mit +0,8 mm seitlich) und eine eingeebnete Stelle im Höhenschlag.
- Seiten-/Höhenschlag werden mittelwertfrei verglichen, da der Abstand zur Referenzkante absolut nicht von Interesse ist.
- Störungen (`Disturbances`) sind als Konfiguration angelegt, werden aber erst in Stufe 2 umgesetzt; der Generator lehnt sie bisher ab.

## Stufenplan

1. Generator plus Auswertung `ideal` ← **aktuell**
2. Störungen (Rauschen, Unschärfe, Wackeln, Maßstabsdrift, ungleichmäßige Drehung, Glanzlicht, fehlende Marke), Rechenmodell mit kleinsten Fehlerquadraten, Diagramme
3. Bildschirm mit dem iPhone abfilmen
4. Echtes Rad mit Halterung, Abgleich mit Messuhren

Ziel-Genauigkeit am Ende: ±0,2 mm.
