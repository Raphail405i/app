# Scopeboard: Was du für einen echten Start brauchst

Scopeboard hilft Freelancern, zusätzliche Kundenwünsche mit Preis und Zeitbedarf festzuhalten und eine Freigabe einzuholen. Der vorgesehene Premiumpreis beträgt **10 € pro Monat**. Der erste Stand ist eine Entwicklungsbasis; eine zahlungsbereite Zielgruppe und eine belastbare Marktlücke sind noch nicht nachgewiesen. Die Marktbeobachtung steht separat in der Recherche-Dokumentation.

**Ein produktives Deployment und echte Zahlungen sind nicht aktiviert.** Ein funktionierender lokaler Test ersetzt weder einen Live-Zahlungstest noch einen Betriebs- oder Rechtscheck. Dauerhaftes oder passives Einkommen und völlige Fehlerfreiheit sind nicht garantiert.

## Was von dir kommen muss

| Voraussetzung | Deine Entscheidung oder Aufgabe |
| --- | --- |
| Zielgruppe | Einen engen Einstieg wählen, beispielsweise selbstständige Webdesigner mit internationalen Geschäftskunden. Mit potenziellen Kunden sprechen und das Problem sowie Zahlungsbereitschaft überprüfen. |
| Name und Domain | Arbeitsnamen auf Marken- und Domainkonflikte prüfen; eine Domain registrieren. |
| Unternehmen | Rechtsform, Geschäftsadresse, Rechnungsangaben und steuerliche Behandlung mit passenden Fachleuten klären. |
| Hosting | Einen Node-24-Host mit HTTPS, dauerhaftem Datenträger, gesicherten Umgebungsvariablen, Monitoring und Backups wählen. Ein flüchtiges Dateisystem reicht für die Datenbank nicht. Hinter einem Reverse-Proxy nur dessen tatsächliche IPs/CIDRs über `TRUST_PROXY` freigeben und Ratenlimits testen. |
| Zahlungsanbieter | Eigenes Stripe-Konto eröffnen, Unternehmens- und Identitätsprüfung abschließen und Auszahlungskonto hinterlegen. Zuerst im Testmodus arbeiten. |
| Aboangebot | Monatliches Stripe-Produkt mit wiederkehrendem EUR-Preis von 1.000 Cent, Intervall 1 Monat und Steuerverhalten „inclusive“ anlegen. Die App ist auf 10 € einschließlich anfallender Steuern ausgelegt und verwendet Stripe Tax. Steuerregistrierungen sowie Zielländer und Kundentypen mit Steuerberatung klären. |
| Rechtliche Texte | Impressum, Datenschutzerklärung, Nutzungs- und Abobedingungen, Kündigungs- und gegebenenfalls Widerrufsabläufe für die Zielmärkte prüfen lassen. |
| Datenschutz | Verantwortlichkeit, Aufbewahrungsfristen, Auskunft/Löschung, Auftragsverarbeitungsverträge mit Dienstleistern und mögliche internationale Datentransfers klären. |
| Betrieb | Eine erreichbare Supportadresse und Zuständigkeit für Updates, Ausfälle, Abos, Löschanfragen und Sicherheitsmeldungen festlegen. |

Zugangsdaten niemals in Chat, Quellcode oder Git eintragen. Sie gehören in die geschützten Einstellungen des Hostinganbieters. Keine privaten Schlüssel für Screenshots oder Testberichte offenlegen.

## Zahlung und Veröffentlichung

1. `APP_ORIGIN` auf die endgültige HTTPS-Adresse setzen. Die SQLite-Datenbank über `DATABASE_PATH` auf einem dauerhaften Datenträger ablegen.
2. `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` und `STRIPE_WEBHOOK_SECRET` sicher konfigurieren. Test- und Live-Schlüssel sowie die jeweiligen Produktpreise und Webhook-Secrets getrennt halten.
3. Einen Stripe-Webhook auf `https://DEINE-DOMAIN/api/billing/webhook` einrichten. Die Ereignisse `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` und `customer.subscription.deleted` auswählen. Die App prüft die Signatur, verarbeitet Ereignisse nacheinander, behandelt Wiederholungen idempotent und verhindert die erneute Freischaltung bereits beendeter Abos durch verspätete Ereignisse. Der Checkout-Rücksprung allein schaltet kein Premium frei.
4. Im Stripe-Testmodus Anmeldung, Checkout, Premiumfreischaltung nach signiertem Webhook, Kündigung über das Kundenportal, Zahlungsfehler und doppelte Webhook-Zustellung prüfen. Nach einer Kündigung müssen die angezeigten Rechte mit der bezahlten Laufzeit übereinstimmen.
5. Stripe Tax, Steuerregistrierungen und Zahlungsbelege konfigurieren und prüfen; sie werden durch ein Preisfeld nicht automatisch korrekt eingerichtet.
6. Erst nach erfolgreicher Prüfung und vollständigen Rechtstexten Live-Schlüssel verwenden. Mit einem kontrollierten echten Kauf auch Auszahlung, Beleg, Kündigung und gegebenenfalls Rückerstattung testen.

Stripe-Gebühren, mögliche Umsatzsteuer, Hosting, Support, Rückerstattungen und Kundenakquise reduzieren den Erlös. **100 aktive Abos ergeben 1.000 € monatlich vor diesen Abzügen**, nicht 1.000 € Gewinn. Kündigungen, ausbleibende Zahlungen und die laufende Gewinnung neuer Kunden gehören zur Planung.

## Grenzen, die vor einem öffentlichen Start geklärt werden müssen

- **Freigabelinks sind Zugangsschlüssel:** Wer einen Link besitzt, kann die dafür vorgesehene Aktion ausführen. Die Links sind auf 30 Tage begrenzt; beim erneuten Erstellen wird ein neuer Link erzeugt und der alte ungültig. Links nur an den vorgesehenen Kunden senden. Eine eingegebene Namensangabe ist keine verifizierte Identität und keine qualifizierte elektronische Signatur. Die rechtliche Bedeutung einer Freigabe hängt von Vertrag und Rechtsordnung ab.
- **Einzelinstanz mit SQLite:** Für einen kleinen Einstieg ist ein dauerhaft gespeicherter Einzelserver vorgesehen. Mehrere App-Instanzen mit voneinander getrennten Datenbanken funktionieren nicht als gemeinsamer Dienst. Vor horizontaler Skalierung müssen Datenbank, Sitzungen und Ratenbegrenzung entsprechend angepasst werden.
- **Backups müssen wiederherstellbar sein:** Verschlüsselte, zugriffsgeschützte Sicherungen außerhalb des Servers planen, die konsistente SQLite-Backups einschließlich des WAL-Betriebs berücksichtigen. Eine Wiederherstellung auf einer getrennten Instanz tatsächlich durchführen und dokumentieren. Dateikopien während laufender Schreibzugriffe sind kein verlässlicher Backupplan.
- **Konten und E-Mail:** Der erste Stand setzt keinen E-Mail-Dienst voraus. Verifizierte E-Mail-Adressen, ein sicherer Passwort-zurücksetzen-Ablauf und Missbrauchsschutz sind vor einem breiten öffentlichen Start zu ergänzen und zu testen; Freigabelinks werden zunächst manuell geteilt.
- **Auskunft und Löschung:** Ein Datenexport allein erfüllt nicht alle Datenschutzpflichten. Eine Kontolöschfunktion ist noch nicht enthalten. Einen sicheren, nachvollziehbaren Prozess für Kontolöschung, Kundendaten, Backups und gesetzliche Aufbewahrungspflichten festlegen und umsetzen.
- **Sicherheitsbetrieb:** HTTPS, eingeschränkter Serverzugriff, aktuelle Abhängigkeiten, Alarmierung und ein Verfahren für Sicherheitsmeldungen sind laufende Aufgaben. Vor sensiblen Kundendaten und öffentlicher Vermarktung ist eine unabhängige Sicherheitsprüfung sinnvoll. Testabdeckung beweist keine Abwesenheit von Schwachstellen.

## Zwei Wochen, um die Geschäftsidee zu prüfen

**Tage 1–3:** Zehn bis fünfzehn Freelancer aus einer klaren Zielgruppe ansprechen. Nach den letzten echten Zusatzwünschen, verlorener Arbeitszeit, bisherigen Freigaben und verwendeten Werkzeugen fragen. Aussagen dokumentieren, ohne personenbezogene Kundendaten unnötig zu sammeln.

**Tage 4–7:** Fünf Personen einen vollständigen Ablauf mit Beispieldaten ausprobieren lassen: Projekt, Zusatzwunsch, Preis, Freigabelink, Kundenentscheidung. Beobachten, wo Hilfe nötig ist. Mit vorhandenen Werkzeugen vergleichen und prüfen, ob ein zusätzlicher Dienst tatsächlich Arbeit spart.

**Tage 8–10:** Ein transparentes Pilotangebot für 10 € monatlich zeigen. Konkrete Zahlungsbereitschaft und wiederkehrenden Bedarf erfragen; unverbindliches Lob ist kein Umsatznachweis. Echte Zahlungen erst nach rechtlicher und technischer Vorbereitung annehmen.

**Tage 11–14:** Festhalten, wie viele Teilnehmer den Kernablauf ohne Hilfe abschließen, einen realen Zusatzauftrag damit bearbeiten und zum Preis weiternutzen möchten. Vorab ein Entscheidungskriterium setzen, beispielsweise drei verbindlich interessierte Pilotkunden aus zehn qualifizierten Gesprächen. Das ist ein eigenes Validierungsziel, keine Marktprognose. Bei fehlender Zahlungsbereitschaft Zielgruppe oder Angebot anpassen, bevor größere Werbeausgaben entstehen.
