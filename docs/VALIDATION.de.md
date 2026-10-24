# Validierungsstand – 24.10.2026

Geprüft in dieser Cloud-Maschine mit Node 24.19.0, npm 11.9.0 und System-Chromium. Dies bestätigt weder ein produktives Deployment noch eine Wiederherstellung in einer neu veröffentlichten Umgebung.

| Prüfung | Ergebnis |
| --- | --- |
| Installation aus Lockdatei: `npm ci --cache /tmp/scopeboard-npm` | bestanden |
| TypeScript und Produktionsbundle: `npm run build` | bestanden |
| Backend: `npm test` | 15 bestanden, 0 fehlgeschlagen, 0 übersprungen |
| Browser: `npm run test:e2e` | 3 bestanden, 0 fehlgeschlagen |
| Abhängigkeiten: `npm audit --cache /tmp/scopeboard-npm` | keine bekannten Schwachstellen gemeldet |
| App-Start, Session-API und Dashboard im Browser | bestanden; keine JavaScript-Laufzeitfehler |
| Echte Stripe-Zahlung, Steuerberechnung und Kundenportal | nicht ausgeführt; Zugangsdaten fehlen |
| Öffentliches Hosting, TLS, echte Proxy-Kette und Backup-Wiederherstellung | nicht ausgeführt; Betreiberkonfiguration fehlt |
| Bestätigte internationale Nachfrage/Zahlungsbereitschaft | nicht nachgewiesen |

Die Backendtests prüfen unter anderem Kontentrennung, Sitzungs- und Origin-Schutz, serverseitige Tariflimits, Freigabeentscheidungen/Wiederholungen/Ablauf, CSV-Formelschutz, Proxy-Ratenlimits, signierte Stripe-Ereignisse, verspätete Kündigungsereignisse und Abo-Neustarts. Stripe-Netzwerkaufrufe sind dabei simuliert; die Signaturprüfung verwendet das echte SDK.

Die Browsertests verwenden eine eigene temporäre Datenbank: Beispieldaten suchen/filtern/erweitern; echtes Testkonto mit Projekt und Kundenfreigabe über einen getrennten Browserkontext; unveränderte 850,50 € auf Kunden- und Betreiberseite; erneute Anmeldung; mobile Navigation bei 375 px ohne Dokumentüberlauf.

Der unabhängige Code-Review fand und beseitigte Fehler bei Login-Nutzdaten, Projektfarben, Centdarstellung, Abo-Lebenszyklus, gleichzeitig eintreffenden Webhooks und Proxy-Konfiguration. Eine Prüfung dieser Abläufe beweist keine völlige Schwachstellenfreiheit. Die fehlenden Produktionsfunktionen stehen in README und LAUNCH.de.md.

`install_script` und `start_skill` wurden als Cloud-Konfigurationsentwurf gespeichert. Eine Veröffentlichung dieses Entwurfs und ein öffentliches App-Deployment sind nicht erfolgt. Die Standard-Entwicklungsdatenbank enthält keine Testkonten; die Dashboardbeispiele liegen nur im Browser.
