# Team Pull Optimizer - Projektbeschreibung und Anforderungskatalog

## Zielbild

Der Team Pull Optimizer ist eine smartphone-optimierte Web-App fuer kurze,
admin-gepflegte Strava-/GPX-Segmente. Die App berechnet fuer ein Team von
Fahrern die beste Verteilung der Fuehrungsarbeit auf einem Segment.

Der MVP folgt bewusst einer einfachen taktischen Regel:

> Jeder Fahrer macht hoechstens einen maximalen Pull und faellt danach aus der
> Fuehrungsarbeit heraus.

Es gibt in der ersten Version also keine wiederholte Rotation, keine Erholung
zwischen mehreren Pulls und keine zweite Fuehrungsrunde. Die App sucht nur:

- welche Fahrer eingesetzt werden
- in welcher Reihenfolge sie fahren
- wie lang jeder Pull ist
- welche Leistung je Pull sinnvoll ist
- welche Gesamtzeit daraus entsteht

## Zielgruppe

- Teams, die kurze Segmente gemeinsam fahren wollen
- Trainingsgruppen
- Strava-KOM-/QOM-Versuche
- kleine Rennrad-/Triathlon-Gruppen
- Coaches, die Team-Taktiken vergleichen wollen

## Rollenmodell

### Admin

Admins pflegen die Strecken zentral. Normale Nutzer duerfen keine neuen
Strecken anlegen.

Admin-Funktionen:

- GPX-Strecken hochladen
- Strecken pruefen
- Name, Beschreibung, Kategorie und Sichtbarkeit setzen
- Strecken veroeffentlichen, deaktivieren oder archivieren
- fehlerhafte Strecken korrigieren oder loeschen

### Fahrer / normaler Nutzer

Nutzer koennen:

- einen Account erstellen
- Fahrerprofil pflegen
- Rad-/Aero-Daten pflegen
- Teams erstellen oder einem Team beitreten
- vorhandene Admin-Strecken auswaehlen
- Simulationen starten
- Ergebnisse speichern und teilen

Nutzer koennen nicht:

- GPX-Strecken hochladen
- Strecken veraendern
- Strecken veroeffentlichen

## Mobile-First App-Flow

Normaler Nutzer:

1. Login
2. Fahrerprofil pflegen
3. Team auswaehlen
4. vorhandene Strecke auswaehlen
5. Bedingungen einstellen
6. Simulation starten
7. Strategie anzeigen, speichern, teilen

Admin:

1. Login als Admin
2. Admin-Bereich oeffnen
3. GPX hochladen
4. Strecke pruefen
5. Strecke benennen und konfigurieren
6. Strecke veroeffentlichen

## MVP-Regel: One Pull Then Out

Jeder Fahrer darf maximal einmal fuehren. Nach seinem Pull wird er fuer weitere
Fuehrungsarbeit nicht mehr genutzt.

Beispielstrategie:

```text
Fahrer 3: 18 s / 210 m / 690 W
Fahrer 1: 42 s / 520 m / 510 W
Fahrer 4: 74 s / 870 m / 390 W
Ziel erreicht
```

Moegliche Entscheidungen der Optimierung:

- Fahrerreihenfolge
- Pull-Dauer oder Pull-Distanz
- Leistung je Pull
- Fahrer auslassen, wenn sie die Gesamtzeit verschlechtern
- letzter Fahrer faehrt bis ins Ziel

Nicht Bestandteil des MVP:

- wiederholte Pulls
- Erholung nach Fuehrung
- mehrfache Rotation
- komplexe Mannschaftsformationen
- Live-Tracking
- automatische Strava-API-Integration

## Fahrerprofil

Pflichtdaten:

- Alias / Fahrername
- Gewicht
- Groesse
- FTP
- 5-s-Leistung
- 1-min-Leistung
- 5-min-Leistung

Optionale Daten:

- technische Sicherheit in Kurven
- Tagesform-Faktor
- maximale Risikobereitschaft
- bevorzugte Position im Team

## Bike- und Aero-Profil

Pflichtdaten:

- Radgewicht
- grober CdA-Wert oder Setup-Schaetzung
- Rollwiderstandsannahme

Optionale Daten:

- Reifentyp
- Position: Hoods, Drops, Aero/TT
- CdA-Skalierung nach Koerpergroesse und Gewicht
- Drafting-Verhalten

## Streckenmodell

Admin-GPX wird serverseitig verarbeitet:

- GPX-Punkte einlesen
- Distanz berechnen
- Hoehenprofil glaetten
- Steigung je Abschnitt berechnen
- Segmentrichtung berechnen
- Kurven ueber Richtungswechsel erkennen
- Strecke in kleine Simulationsabschnitte zerlegen

Empfohlene Aufloesung im MVP:

- 10 m bis 25 m fuer kurze Segmente
- alternativ 5 s bis 25 m je nach Performance

## Physikalisches Simulationsmodell

Die Strecke wird als Folge kurzer Abschnitte simuliert. Fuer jeden Abschnitt
wird berechnet, welche Geschwindigkeit das Team bei gegebener Leistung des
fuehrenden Fahrers erreicht.

Grundgleichung:

```text
P_rad = v * (F_aero + F_roll + F_steigung + F_beschleunigung)
```

Fuer den MVP kann `F_beschleunigung` vereinfacht werden. Sie wird vor allem
bei Kurven, Tempoaenderungen und Wechseln relevant.

### Aerodynamik

Der fuehrende Fahrer bestimmt den groessten Luftwiderstand:

```text
F_aero = 0,5 * rho * CdA_front * v_rel^2
```

Dabei:

- `rho`: Luftdichte
- `CdA_front`: CdA des fuehrenden Fahrers
- `v_rel`: Geschwindigkeit relativ zum Wind

Die Fahrer im Windschatten brauchen weniger Leistung. Fuer die
Teamgeschwindigkeit zaehlt primaer, ob der Fuehrende die erforderliche Leistung
liefern kann. Optional prueft das Modell, ob nachfolgende Fahrer im Windschatten
nicht ueberlastet werden.

Ein einfaches Drafting-Modell:

```text
CdA_draft = CdA_rider * draft_factor
```

Startwerte:

- 1. Position: 100 Prozent CdA
- 2. Position: 65-75 Prozent CdA
- 3. Position: 55-65 Prozent CdA
- 4.+ Position: 50-60 Prozent CdA

### Rollwiderstand

```text
F_roll = Crr * m_system * g * cos(arctan(grade))
```

Dabei:

- `Crr`: Rollwiderstandskoeffizient
- `m_system`: Fahrer + Rad
- `g`: 9,81 m/s^2
- `grade`: Steigung als Dezimalzahl

### Steigung

```text
F_steigung = m_system * g * sin(arctan(grade))
```

Bergauf wirkt Fahrergewicht stark. Bergab hilft Gewicht teilweise, aber bei
hoher Geschwindigkeit dominiert Aerodynamik.

### Wind

Wind wird als Vektor modelliert:

- Segmentrichtung aus GPX
- Windrichtung und Windstaerke
- daraus Gegenwind, Rueckenwind und Seitenwind

Relative Luftgeschwindigkeit:

```text
v_rel = |v_bike_vector - v_wind_vector|
```

Spaeter kann Seitenwind ueber Yaw-Tabellen den CdA veraendern.

### Kurven

Kurven werden ueber Richtungswechsel in der GPX-Strecke erkannt.

MVP-Modell:

- starke Richtungswechsel erkennen
- maximale Geschwindigkeit vor engen Kurven begrenzen
- nach Kurven ggf. Beschleunigungskosten ansetzen
- technische Fahrerfaehigkeit optional als Faktor nutzen

### Wechsel

Jeder Wechsel erzeugt eine kleine Stoerung:

```text
wechselverlust = 0,3 bis 1,5 Sekunden
```

Alternativ spaeter physikalisch:

```text
E_beschleunigung = 0,5 * m * (v_neu^2 - v_alt^2)
```

## Power-Duration-Modell

Aus vier Leistungswerten je Fahrer wird eine maximale Pull-Leistung fuer jede
Dauer `t` geschaetzt:

- 5 s
- 1 min
- 5 min
- FTP

Stuetzpunkte:

```text
(5 s, P5s)
(60 s, P1min)
(300 s, P5min)
(3600 s, FTP)
```

MVP-Interpolation:

```text
x = log(t)
P_max(t) = linear_interpolate(log(t1), P1, log(t2), P2, x)
```

Damit entsteht eine einfache Power-Duration-Kurve. Sehr kurze Pulls werden bei
P5s gedeckelt. Lange Pulls naehern sich FTP.

### Belastungsreserve

Eine mathematisch maximale Strategie ist oft praktisch zu riskant. Deshalb kann
die App einen Effort-Faktor nutzen:

```text
P_pull = P_max(t) * effort_factor
```

Beispiele:

- konservativ: 0,92
- normal: 0,96
- aggressiv: 1,00
- all-out: 1,03 mit hohem Risiko

## Simulation einer Kandidatenstrategie

Eine Kandidatenstrategie besteht aus:

```text
order = [Fahrer C, Fahrer A, Fahrer D]
pull_durations = [18 s, 42 s, 74 s]
effort = [1,00, 0,98, 0,97]
```

Simulationsablauf:

1. Start bei Distanz 0.
2. Erster Fahrer geht in Fuehrung.
3. Pull-Dauer oder Pull-Distanz festlegen.
4. Aus Pull-Dauer wird `P_max(t)` bestimmt.
5. Pull-Leistung berechnen.
6. Abschnitt fuer Abschnitt Geschwindigkeit loesen.
7. Pull endet, Wechselverlust anwenden.
8. Naechster Fahrer uebernimmt.
9. Wiederholen, bis Ziel erreicht oder Fahrer verbraucht sind.
10. Gesamtzeit berechnen.

Eine Strategie ist ungueltig, wenn:

- das Ziel nicht erreicht wird
- Pull kuerzer als Mindestdauer ist
- Pull laenger als Maximaldauer ist
- Fahrerleistung ueber erlaubter Power-Duration-Leistung liegt
- die Gruppe unrealistisch schnell wird
- nachfolgende Fahrer im Windschatten nicht mithalten koennen

## Numerische Optimierung

Gesucht wird:

```text
minimiere Gesamtzeit
```

Nebenbedingungen:

```text
jeder Fahrer hoechstens 1 Pull
Pull-Dauer zwischen min_pull und max_pull
P_pull <= erlaubte Leistung aus Power-Duration-Kurve
Ziel muss erreicht werden
Wechselverluste werden eingerechnet
```

Optimierungsvariablen:

- Fahrerreihenfolge
- eingesetzte Fahrer
- Pull-Dauer je Fahrer
- optional Effort-Faktor je Pull

## Monte-Carlo-Optimierung

Die App erzeugt viele zufaellige Strategien und bewertet sie mit der
Physiksimulation.

Pseudo-Code:

```text
best = None

for i in 1..N:
    order = zufaellige Reihenfolge der Fahrer
    k = zufaellige Anzahl eingesetzter Fahrer
    order = order[0:k]

    pull_lengths = []
    for rider in order:
        t = random(min_pull, max_pull)
        pull_lengths.append(t)

    strategy = (order, pull_lengths)
    result = simulate(strategy)

    if result.valid and result.time < best.time:
        best = result
```

Warum Monte-Carlo passt:

- Reihenfolge ist kombinatorisch
- Pull-Laengen sind kontinuierlich
- Wind, Steigung, Kurven und Fahrerprofile machen die Zielfunktion nicht glatt
- es ist einfach parallelisierbar
- es liefert schnell brauchbare Strategien

## Monte-Carlo plus lokale Suche

Nach der zufaelligen Suche wird die beste Strategie lokal verbessert.

Moegliche Mutationen:

- zwei Fahrer tauschen
- Pull A +5 s
- Pull B -5 s
- Fahrer entfernen
- Fahrer hinzufuegen
- Effort-Faktor leicht aendern

Pseudo-Code:

```text
best = monte_carlo_best()

while improvement:
    candidates = mutate(best)
    for candidate in candidates:
        result = simulate(candidate)
        if result.time < best.time:
            best = result
```

## Pull-Laengen-Optimierung

Fuer den MVP werden Pull-Laengen diskretisiert:

```text
possible_pull_lengths = [5, 10, 15, ..., 180]
```

Das reduziert den Suchraum und ist fuer kurze Segmente ausreichend. Intern ist
Pull-Dauer physiologisch sinnvoller als Pull-Distanz, weil die Leistungsgrenze
von der Dauer abhaengt. In der UI kann trotzdem Distanz angezeigt werden.

## Risikobewertung

Pro Pull:

```text
risk = P_pull / P_max(t)
```

Beispielklassen:

- `< 0,92`: konservativ
- `0,92-0,97`: realistisch
- `0,97-1,00`: hart
- `> 1,00`: sehr riskant

Die App sollte nicht nur die schnellste Strategie zeigen, sondern auch eine
robuste Alternative.

## Ergebnisdarstellung

Die Ergebnisansicht muss mobil gut lesbar sein.

Pflicht:

- Gesamtzeit
- Durchschnittsgeschwindigkeit
- beste Reihenfolge
- Pull-Dauer je Fahrer
- Pull-Distanz je Fahrer
- Zielpower je Pull
- Risiko je Pull
- Fahrer, die nicht eingesetzt wurden

Soll:

- Top-5-Strategien
- Vergleich gegen gleichmaessige Reihenfolge
- Diagramm ueber Distanz: Fahrer vorne, Leistung, Geschwindigkeit, Steigung
- kurze Begruendung, warum die Strategie gewaehlt wurde

Beispiel:

```text
Beste Strategie

1. Anna: 18 s / 210 m / 690 W / Risiko hart
2. Ben: 42 s / 520 m / 510 W / Risiko realistisch
3. Chris: 74 s / 870 m / 390 W / Risiko realistisch

Gesamtzeit: 2:14.8
Durchschnitt: 48.3 km/h
Wechselverluste: 1.2 s
```

## Empfohlene MVP-Parameter

```text
Segmentaufloesung: 10-25 m
min Pull: 5 s
max Pull: 180 s
Pull-Schritt: 5 s
Monte-Carlo-Laeufe: 5.000-50.000
lokale Iterationen: 200-2.000
Wechselverlust: 0,5 s
Draft-Faktor 2. Fahrer: 0,70
Draft-Faktor 3+: 0,60
Effort-Faktor: 0,96-1,00
```

## Technische MVP-Anforderungen

- Mobile-first Web-App
- PWA-faehig
- Accountsystem
- Rollen: Admin, Fahrer
- Admin-only Streckenverwaltung
- Fahrerprofil mit Power-Duration-Daten
- Teamverwaltung
- serverseitige Simulation
- gespeicherte Strategien
- teilbare Ergebnislinks

## Nicht-Ziele fuer Version 1

- native iOS-/Android-App
- Live-Tracking
- automatische Strava-API-Integration
- vollstaendiges Peloton-/CFD-Modell
- wiederholte Pulls mit Erholung
- komplexe Teamformationen
