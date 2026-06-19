# Ironman Bike Split Predictor - Python GUI

Lokale Desktop-Variante der Simulation mit Tkinter. Es werden keine externen Python-Pakete benoetigt.

## Start

Aus dem Projektordner:

```powershell
python python_gui\ironman_bike_split_predictor.py
```

Oder per Doppelklick:

```text
start_python_gui.bat
```

## Smoke-Test ohne GUI

```powershell
python python_gui\ironman_bike_split_predictor.py --smoke-test
```

Der Smoke-Test nutzt standardmaessig `public\courses\IMFFM26_Bike.gpx`.

## Umfang

- GPX laden oder die mitgelieferte Frankfurt-2026-GPX laden
- Profil, Zielpower, Zielzeit, Terrain-Pacing, CdA-Skalierung und Wetter einstellen
- lokale Simulation mit dem gleichen physikalischen Modell wie die Web-App
- Ergebnisuebersicht, Power/Speed/Hoehenprofil und einfache Routenskizze
