# BBS Public Plan 314278 Validation

Validated on 2026-06-19 against:
https://www.bestbikesplit.com/public/314278

Input route:
`validate/GPX-Route_135568_251066.gpx`

Public BBS reference values:

| Metric | Value |
| --- | ---: |
| Race | Hamburg 2025 Real Sim |
| Course | IRONMAN Hamburg 2025 official |
| Distance | 179.65 km |
| Time | 04:26:07 |
| Avg speed | 40.51 km/h |
| Avg power | 271.56 W |
| Avg CdA | 0.2593 |
| Avg Crr | 0.0035 |
| Effective elevation | +303 / -307 m |
| Bike | Speedmax2023Disc |

Local route parse:

| Metric | Value |
| --- | ---: |
| Points | 3319 |
| Distance | 179.602 km |
| Segments | 180 |
| Ascent | 313 m |
| Descent | 313 m |

Validation command:

```powershell
python .\tools\validate_bbs.py --gpx .\validate\GPX-Route_135568_251066.gpx --rider-weight 90 --bike-weight 9
```

Result:

| Scenario | Local Time | Delta vs BBS | Delta % | Speed | Avg yaw |
| --- | ---: | ---: | ---: | ---: | ---: |
| BBS mass, wind bearing as from | 04:25:30 | -36.9 s | -0.23% | 40.59 km/h | 6.14 deg |
| BBS mass, wind bearing as to | 04:25:45 | -22.4 s | -0.14% | 40.55 km/h | 6.11 deg |
| User mass 90/9, wind bearing as from | 04:25:40 | -27.3 s | -0.17% | 40.56 km/h | 6.15 deg |
| User mass 90/9, wind bearing as to | 04:25:54 | -12.7 s | -0.08% | 40.53 km/h | 6.12 deg |
| User mass 90/9, averaged weather | 04:25:37 | -30.2 s | -0.19% | 40.57 km/h | 6.45 deg |

Conclusion:

The closest tested interpretation is `User mass 90/9, wind bearing as to`: local model is 12.7 seconds faster than BBS over 04:26:07, an error of -0.08%.
