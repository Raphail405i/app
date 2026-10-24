# Scopeboard: Marktprüfung und Geschäftsmodell

Prüfdatum: 24. Oktober 2026. Arbeitsstand für eine erste Produktversion, keine bestätigte Marktstudie.

## Ergebnis

Empfehlung: eine kleine Web-App für Freelancer und kleine Kreativ-/Digitalagenturen, die zusätzliche Kundenwünsche mit Preis und Zeitaufwand dokumentiert und vor Arbeitsbeginn eine Freigabe einholt. Arbeitstitel Scopeboard. Gegenüber einer Rechnungs-/Mahn-App benötigt dieser Ablauf keine Bank-, Buchhaltungs- oder E-Mail-Postfachintegration und lässt sich als erste Version mit einer überschaubaren Angriffsfläche entwickeln.

**Die internationale Nachfrage, eine unbesetzte Marktlücke und Zahlungsbereitschaft für 10 EUR/Monat sind noch nicht nachgewiesen.** Es wurden keine aktuellen Umsatz-, Nutzer- oder Marktwachstumszahlen verifiziert. Insbesondere lässt sich nicht seriös behaupten, alle Webseiten ausgewertet zu haben.

## Tatsächlich erreichbare Primärquellen

1. Invoice Ninja, offizielles Repository, abgerufen am 24.10.2026:
   https://github.com/invoiceninja/invoiceninja
   https://raw.githubusercontent.com/invoiceninja/invoiceninja/v5-stable/README.md
   Nachweis: Die README beschreibt eine gehostete SaaS- und eine selbst gehostete Rechnungslösung; Pro-/Enterprise-Funktionen sind im veröffentlichten Source-available-Code enthalten. Sie nennt eine White-Label-Lizenz von 40 USD/Jahr für das Entfernen des Brandings bei Self-Hosting. Das ist **kein** verifizierter Preis des gehosteten Abonnements.
2. Invoice Ninja, offizielle Client-Routen:
   https://raw.githubusercontent.com/invoiceninja/invoiceninja/v5-stable/routes/client.php
   Nachweis: `POST quotes/approve` ist vorhanden; Kundenfreigaben für Angebote existieren bereits bei einem Wettbewerber.
3. Invoice Ninja, offizielle API-Routen:
   https://raw.githubusercontent.com/invoiceninja/invoiceninja/v5-stable/routes/api.php
   Nachweis: Angebotsverwaltung und `invoices/update_reminders` sind vorhanden. Das bestätigt funktionale Konkurrenz für Angebotsfreigaben und Zahlungserinnerungen.

Die Quellen belegen vorhandene Angebote, nicht deren Umsatz, Nutzerzufriedenheit oder ungedeckte Nachfrage. Der gelesene Branch ist veränderlich; Angaben beziehen sich auf das Prüfdatum.

## Nicht erreichbare Quellen

Die Netzwerk-Richtlinie dieser Cloud-Umgebung wies die folgenden HTTPS-Abfragen mit `403 Forbidden` beim Proxy-Tunnel ab. Auch Varianten ohne `www` wurden getestet, soweit vorhanden. Daraus wurden keine Preis- oder Nachfrageangaben übernommen:

- https://www.hellobonsai.com/pricing
- https://www.getharvest.com/pricing
- https://www.chaserhq.com/pricing
- https://www.freshbooks.com/pricing
- https://www.upwork.com/research/future-workforce-index-2025
- https://www.freelancermap.com/blog/freelancer-study-2025/
- https://www.latepaymentresearch.com/

Für eine umfassendere aktuelle Recherche müssen diese Zielhosts in den Umgebungseinstellungen freigegeben werden oder überprüfbare Marktunterlagen bereitstehen. Kein Einsatz von erfundenen Preisen als Ersatz.

## Positionierung als prüfbare Hypothese

| Alternative | Belegbarer Stand | Möglicher Ansatz für Scopeboard |
| --- | --- | --- |
| Invoice Ninja | Angebote, Kundenfreigaben, Rechnungen, Erinnerungsfunktionen existieren laut offizieller Quelle | Zusätzliche Projektwünsche in einem einzigen schlanken Ablauf dokumentieren; kein Ersatz für Buchhaltung |
| Bonsai, Harvest, Chaser, FreshBooks | Aktuelle Preise und Funktionsumfang in dieser Umgebung nicht verifiziert | Direkten Vergleich erst nach erreichbarer Primärquelle aktualisieren |
| E-Mail/Tabellen | Plausible Alternative, Nutzung hier nicht quantitativ gemessen | Schnelleres, verständliches Freigabeprotokoll als zu testender Vorteil |

Internationalisierung sollte zunächst Deutsch und Englisch, lokale Zahlen-/Datumsformate und eine klare Währung je Projekt abdecken. Ein international verständlicher Ablauf allein belegt keine internationale Nachfrage.

## 10 EUR Premium

Vorschlag: Kostenloses Kennenlernen mit begrenzten aktiven Projekten; Premium für 10 EUR monatlich mit mehr Projekten, Kundenfreigaben und Export. Die konkrete Grenze sollte durch Nutzungstests geprüft werden. Bezahlen darf keinen gefälschten lokalen Premium-Schalter auslösen; Freischaltung ausschließlich nach serverseitig bestätigtem Zahlungsanbieter-Ereignis. Kündigung und Zahlungsdatenverwaltung über das Kundenportal.

100 zahlende Konten × 10 EUR ergeben 1.000 EUR monatliche Zahlungseingänge vor Umsatzsteuer, Zahlungsgebühren, Hosting, Support, Akquise und Rückerstattungen. Das ist eine Rechenannahme, keine Prognose und kein Gewinnversprechen. Ob 10 EUR als Bruttopreis oder Nettopreis beworben werden, muss zur Zielgruppe und Steuerbehandlung passen. Bei 19 % Umsatzsteuer sind 10 EUR brutto etwa 8,40 EUR netto vor weiteren Kosten.

## Validierung vor Werbeausgaben

1. Mit mindestens zehn Freelancern oder kleinen Agenturen sprechen: zuletzt unbezahlter Zusatzwunsch, derzeitiger Freigabeprozess, entstandene Zeit-/Geldkosten, vorhandene Tools.
2. Mit fünf Nutzern einen realen Projektänderungsfall durchspielen. Zeit bis zur ersten korrekt verständlichen Freigabe messen; Abbruchgründe erfassen.
3. Nach dem Test die echte Zahlungsentscheidung für 10 EUR/Monat prüfen; bloße Zustimmung zur Idee nicht als Kaufabsicht zählen.
4. Über mehrere Wochen Wiederverwendung und bezahlte Verlängerung verfolgen. Erst bei wiederholtem Nutzen und tragfähigen Akquisekosten skalieren.
5. Bleiben Projektänderungen zu selten oder reichen bestehende Tools aus, Positionierung oder Zielgruppe anpassen, bevor Werbung ausgeweitet wird.

## Beiträge des Betreibers vor öffentlichem Betrieb

Benötigt werden eine Domain, Hosting samt dauerhaftem Datenspeicher/Backups, ein verifiziertes Stripe-Geschäftskonto, ein EUR-Monatsprodukt mit Preis 10 EUR sowie Webhook-Konfiguration und sichere Laufzeit-Secrets. Hinzu kommen Betreiber-/Unternehmensdaten, anwendbare Gewerbe-/Steuerabklärung, Impressum/Datenschutz/Vertragsbedingungen, ein Supportkontakt sowie ein tatsächlich getesteter Prozess für Kündigung, Löschung, Wiederherstellung und Sicherheitsupdates. Vertragsrechtliche Verbindlichkeit einer digitalen Freigabe sollte geprüft und nicht als qualifizierte elektronische Signatur beworben werden.
