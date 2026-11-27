# RimTrace – Anforderungen an die Anwendung

Stand: 26.11.2026. Ergebnis der Anforderungsklärung nach dem PoC (Stufe 1–3).

Verbindlichkeit: **MUSS** = Pflicht, **SOLL** = wenn mit moderatem Aufwand zuverlässig machbar, sonst die genannte Alternative, **KANN** = Nice-to-have.

## 1. Zielbild

RimTrace unterstützt beim Einspeichen und Zentrieren eines Laufrads in mehreren Durchgängen aus Messen und Nachspannen. Das **Handy** ist fest montiert und dient nur als Messkamera. Ein **Zweitgerät** (Notebook oder Tablet) steuert die Messung und zeigt dem Monteur, welche Speichen er wie weit drehen soll.

## 2. Geräte und Rollen

| ID | Anforderung | Stufe |
|---|---|---|
| G1 | Das Handy erfasst die Bilder und **wertet sie selbst aus** (volle Bildqualität). | MUSS |
| G2 | Das Handy überträgt nur Messwerte und Status, **kein Video**. Während der Messung gibt es am Zweitgerät keine Videovorschau. Grund: Die Kamera schaut aus einer anderen Richtung als der Monteur, eine Vorschau hilft nicht. | MUSS |
| G3 | Das Zweitgerät ist das **Hauptgerät**: Einrichtung, Konfiguration, Start und Stopp der Messung, Anweisungen, Verlauf. | MUSS |
| G4 | Ein Betrieb nur mit dem Handy ist **nicht** gefordert. | – |

## 3. Bereitstellung und Verbindung

| ID | Anforderung | Stufe |
|---|---|---|
| V1 | Die App läuft **im Browser ohne lokale Installation** und ist statisch gehostet (z. B. GitHub Pages, HTTPS für die Kamera). | MUSS |
| V2 | Handy und Zweitgerät verbinden sich direkt per **WebRTC (DataChannel)** im selben WLAN. | MUSS |
| V3 | Die Verbindung wird **ohne Vermittlungsserver** aufgebaut: Die Verbindungsdaten werden per **QR-Code** ausgetauscht. Das Zweitgerät zeigt einen QR-Code, den das Handy scannt; die Antwort geht per QR-Code vom Handy zurück an die Webcam des Zweitgeräts. Es gehen keine Daten an Dritte. | MUSS |
| V4 | Rückfallebene, falls V3 nicht zuverlässig funktioniert: ein lokaler Server auf dem Notebook (HTTPS, Handy öffnet die Adresse per QR-Code, Daten per WebSocket). | Alternative |
| V5 | Bricht die Verbindung ab, zeigen beide Geräte das deutlich an; ein erneutes Koppeln ist ohne Datenverlust möglich. | SOLL |

## 4. Einrichtung und Konfiguration

Alle Werte werden am Zweitgerät in einem Dialog eingestellt und im Browser gespeichert.

| ID | Einstellung | Stufe |
|---|---|---|
| K1 | Speichenzahl (Standard 28) | MUSS |
| K2 | **Felgenaußenbreite in mm**, vom Monteur mit dem Messschieber gemessen. Sie ist die einzige Größenreferenz für die Umrechnung px → mm und muss **für jede Felge eingegeben** werden; es gibt keinen fest eingebauten Wert. Ohne Eingabe startet keine Messung. Der Wert gehört zum Laufrad-Profil (K10). | MUSS |
| K3 | Nullpunkt-Marker: Ventilloch (Standard), optional mit weißem oder farbigem Punkt darauf | MUSS |
| K4 | Seite von Speiche 1: Antriebsseite oder Bremsscheibenseite. Danach wechseln die Seiten abwechselnd. | MUSS |
| K5 | **Messbereiche** (Flanken, Hornspitzen, Referenz, Lochfenster) interaktiv aufziehen. Dazu zeigt das Zweitgerät während der Einrichtung **ein Standbild vom Handy** (bei Bedarf alle paar Sekunden aktualisiert). | MUSS |
| K6 | Kamera-Orientierung: Hoch- oder Querformat, gespiegelt | MUSS |
| K7 | Toleranz, ab der eine Maßnahme vorgeschlagen wird; zugleich Abbruchkriterium. Standard **Seite ±0,2 mm, Höhe ±0,3 mm**. | MUSS |
| K8 | Maßnahmen pro Durchgang: alle Speichen, deren Drehung nach dem Modell mindestens ⅛ Umdrehung beträgt (Einflussmodell, siehe README) | MUSS |
| K9 | Faktor „Nippelumdrehungen je mm“, getrennt für Seite und Höhe, mit Modus „manuell“ oder „auto“ (siehe Abschnitt 8) | MUSS |
| K10 | Laufrad-Profile speichern und laden (alle Werte inklusive gelernter Faktoren) | KANN |

## 5. Speichennummerierung

| ID | Anforderung | Stufe |
|---|---|---|
| N1 | **Speiche 1** ist die erste Speiche nach dem Ventilloch **in Fahrtrichtung**. Fahrtrichtung bedeutet die Richtung, in die sich der obere Teil der Felge beim Vorwärtsfahren bewegt. | MUSS |
| N2 | Die Nummerierung läuft **durchgehend** 1 bis Speichenzahl über beide Seiten. | MUSS |
| N3 | Seiten heißen **Antriebsseite** und **Bremsscheibenseite**, nicht links/rechts. | MUSS |
| N4 | Die App zeigt die Zählregel (Start am Ventil, Fahrtrichtung) bei den Anweisungen an. | MUSS |
| N5 | Am Rad sind keine zusätzlichen Marker an Flanke oder Speichen nötig. Grund: Ein Marker an der Felgenflanke verfälscht dort den Seitenschlag. | MUSS |

## 6. Messdurchgang

| ID | Anforderung | Stufe |
|---|---|---|
| M1 | Der Monteur startet den Messlauf am Zweitgerät und dreht das Rad von Hand. | MUSS |
| M2 | Gemessen wird live Bild für Bild; gespeichert werden nur Messwerte, keine Videobilder. | MUSS |
| M3 | Die Drehposition ergibt sich aus Ventilloch (Nullpunkt) und Nippellöchern (ein Marker je Speiche). | MUSS |
| M4 | **Beide Drehrichtungen** sind erlaubt; die App erkennt die Richtung und zählt trotzdem richtig. | MUSS |
| M5 | **Automatischer Stopp**, sobald 2 vollständige, übereinstimmende Umdrehungen erfasst sind. | SOLL |
| M6 | Alternative zu M5: Der Monteur beginnt kurz vor dem Ventilloch, dreht genau 2 Runden, endet kurz nach dem Ventilloch und stoppt am Zweitgerät. Die Aufteilung in Umdrehungen erfolgt erst nach dem Stopp. | Alternative |
| M7 | Weichen die Umdrehungen zu stark voneinander ab oder fehlen Speichen, verlangt die App eine Wiederholung und nennt den Grund (z. B. zu schnell gedreht). | MUSS |

## 7. Zentrierstrategie und Anweisungen

Vorgehen nach Werkstattpraxis (Park Tool, BIKE24).

| ID | Anforderung | Stufe |
|---|---|---|
| Z1 | Ablauf in **Phasen**: 1) Seitenschlag grob, 2) Höhenschlag (paarweise) mit Kontrolle des Seitenschlags, 3) Hinweis zum Abdrücken des Rads, 4) Feinzentrieren beider Achsen. Die App zeigt die aktuelle Phase an. | MUSS |
| Z2 | Pro Durchgang werden die Drehungen aller Speichen aus dem Einflussmodell berechnet (K8), größte zuerst; breite Auslenkungen werden im Verbund mehrerer Speichen behoben. | MUSS |
| Z3 | Höhenkorrekturen werden **paarweise** an benachbarten Speichen beider Seiten gleich stark vorgegeben, damit kein neuer Seitenschlag entsteht. | MUSS |
| Z4 | Seiten- und Höhenkorrektur für denselben Nippel werden zu **einer** Anweisung zusammengefasst. | MUSS |
| Z5 | Anweisungsformat: Speichennummer, Seite, Richtung (anziehen/lösen), Umdrehungen in **⅛-Schritten**, z. B. „Speiche 3 und 5 (Antriebsseite) je ¼ Umdrehung anziehen“. | MUSS |
| Z6 | Nach den Anweisungen: ein Knopf **„Alles umgesetzt – nächste Messung“**. Einzelnes Abhaken ist nicht nötig. | MUSS |
| Z7 | Liegen alle Speichen innerhalb der Toleranz (K7), meldet die App „fertig“. | MUSS |
| Z8 | Speichenspannung und Mittigkeit (Dish) werden **nicht gemessen**. Die App gibt nur Hinweise als eigene Schritte, z. B. „alle Nippel ½ Umdrehung anziehen“ oder „Rad abdrücken“. | MUSS |

## 8. Lernender Korrekturfaktor

| ID | Anforderung | Stufe |
|---|---|---|
| L1 | Der Faktor „Nippelumdrehungen je mm“ ist **manuell einstellbar** mit vorsichtigem Standardwert. | MUSS |
| L2 | Im Modus **auto** vergleicht die App bei jeder Folgemessung die erwartete mit der tatsächlichen Wirkung der Anweisungen und passt den Faktor an. | KANN |
| L3 | Der Faktor wird **getrennt für Seite und Höhe** gelernt. | KANN |
| L4 | Start bei **50 % des geschätzten Werts**, die Änderung pro Durchgang ist begrenzt. | KANN |
| L5 | Gelernte Faktoren werden im Laufrad-Profil gespeichert (mit K10). | KANN |

## 9. Darstellung am Zweitgerät

| ID | Anforderung | Stufe |
|---|---|---|
| D1 | **Liniendiagramm** von Seiten- und Höhenschlag über Speiche 1 bis Speichenzahl, schematisch, ohne Kamerabild. | MUSS |
| D2 | **Vergleich mit dem vorherigen Durchgang**, damit der Fortschritt sichtbar ist. | MUSS |
| D3 | **Speichen mit Anweisung hervorheben** (im Diagramm und in der Liste). | MUSS |
| D4 | Anweisungsliste gut lesbar aus Arbeitsabstand (große Schrift). | MUSS |
| D5 | Toleranzband im Diagramm einblenden. | SOLL |

## 10. Rahmenbedingungen aus dem PoC

- Felge während des Zentrierens **ohne Felgenband**: Nippellöcher und Ventilloch sind sichtbar.
- Messprinzip: Felgenende als Silhouette vor hellem Hintergrund, Seitenschlag relativ zu einer festen senkrechten Referenz, Höhenschlag aus den Hornspitzen relativ zu einer waagerechten Referenzkante.
- Maßstab einmal pro Messung aus der Felgenbreite, nicht pro Bild (Perspektive).
- Felgenaußenbreite der PoC-Felge: **27,5 mm** (Messschieber).
- Erreicht im PoC (IMG_0977, 60 fps, ca. 0,29 mm/px): Übereinstimmung zweier Umdrehungen je Speiche im Mittel 0,29 mm (Seite) und 0,12 mm (Höhe).
- Drehgeschwindigkeit: unter ca. 0,4 Speichen pro Bild, sonst Warnung.

## 11. Offene Punkte

| # | Thema | Klärung durch |
|---|---|---|
| O1 | Ist das Ventilloch zuverlässig vom Nippelloch zu unterscheiden (Größe/Form), mit oder ohne Punkt? | Versuchsvideo |
| O2 | Funktioniert die QR-Kopplung (V3) zuverlässig, insbesondere der Rückweg zur Notebook-Webcam? | Prototyp |
| O3 | Abgleich der mm-Werte mit Klebeband oder Messuhr (Felgenbreite 27,5 mm ist bekannt) | Versuch |
| O4 | Vorsichtiger Startwert für „Nippelumdrehungen je mm“ | Erfahrung am Rad |
| O5 | Geeignete waagerechte Referenzkante für ruhigere Höhenmessung | Versuch |
