# Beweisbare Unsichtbarkeit

## Ein Vertragsmodell für agentengesteuerte CMS-Migrationen am Beispiel von TYPO3 v14

**Dissertation**
Kurt Dirnbauer, webconsulting
Wien, 25. Juli 2026

---

## Abstract

Agentengesteuerte Softwaremigrationen leiden an einem strukturellen Problem: Der Agent, der die
Änderung durchführt, ist zugleich die Instanz, die ihren Erfolg beurteilt. Wenn die Messung von
derselben Kette abhängt wie die Änderung, ist ein grünes Ergebnis kein Beweis, sondern eine
Behauptung.

Diese Arbeit untersucht den Agent Skill `typo3-14-update` (im Verlauf der Arbeit zu
`typo3-upgrade-run` umbenannt, siehe Kapitel 11) — einen Skill zur Migration von TYPO3 v12
und v13 auf 14.3 LTS — und entwickelt aus seiner Analyse ein übertragbares Modell. Ausgangspunkt
ist eine externe statische Tiefenanalyse, die dem Skill hohe fachliche Qualität, aber gravierende
Mängel in Sicherheit, Reproduzierbarkeit und Prompt-Injection-Abwehr attestierte.

Die unabhängige Codeverifikation bestätigte sämtliche Befunde und förderte zusätzlich einen Defekt
zutage, den die statische Analyse nicht erreichen konnte: Drei der fünf Aktionen des Test-Harness
gaben unter keinen Umständen einen von null verschiedenen Exit-Code zurück. Ein Lauf mit vierzig
abweichenden Screenshots endete mit Exit-Code 0. Damit war die gesamte Prämisse „iteriere, bis das
Ergebnis grün ist" nicht durchsetzbar — nicht falsch implementiert, sondern **strukturell nicht
messbar**.

Die Arbeit beantwortet das Selbstbeurteilungsproblem, statt es nur zu benennen (Kapitel 6):
Sie umgeht das Orakel, indem sie Invarianz als **metamorphe Relation** zwischen zwei Läufen
formuliert — kein Wissen über die korrekte Ausgabe nötig, nur über das Verhältnis zweier
Ausführungen. Daraus folgt, dass die Unsichtbarkeit des Updates ein prüftechnisches und kein
ästhetisches Kriterium ist. Vier weitere Mechanismen — Nulllauf, Versiegelung vor der ersten
Änderung, Kanaltrennung, Zustand außerhalb des Kontextfensters — verkleinern die verbleibende
Zirkularität, und ein neuer Vergleich misst sie.

Aus diesem Befund entwickelt die Arbeit fünf Beiträge:

1. **Das Zwei-Vertrags-Modell**, das den Zielkonflikt zwischen „das Update darf nichts verändern"
   und „das Ergebnis soll besser sein" auflöst, indem es beide Ziele in sequentielle, getrennt
   genehmigte Verträge zerlegt.
2. **Determinismus als Vorbedingung von Evidenz**: ein Selbsttest, der beweist, dass das Messwerkzeug
   gegen sich selbst null liefert, bevor es über eine Migration urteilen darf.
3. **Ein beschränktes Schleifenprotokoll**, dessen Abbruchbedingungen aus der Forschung zu
   Self-Conditioning bei LLM-Agenten motiviert sind.
4. **Pinned-Origin-Allowlisting** als Auflösung des Konflikts zwischen SSRF-Abwehr und lokalen
   Entwicklungsumgebungen.
5. **Dokumentation als Evidenzkette**: ein maschinenlesbarer Zustand, der das Transkript als
   Wahrheitsquelle ersetzt.

Die Arbeit ist ehrlich über ihre Grenzen: Sie evaluiert die Architektur, nicht ihren Feldeinsatz.
Kein vollständiger Migrationslauf gegen ein reales Kundenprojekt wurde durchgeführt.

---

## Inhaltsverzeichnis

1. [Einleitung und Problemstellung](#1-einleitung-und-problemstellung)
2. [Forschungsfragen](#2-forschungsfragen)
3. [Stand der Forschung und Praxis](#3-stand-der-forschung-und-praxis)
4. [Methodik](#4-methodik)
5. [Befunde](#5-befunde)
6. [Die Auflösung der Selbstbeurteilung](#6-die-auflösung-der-selbstbeurteilung)
7. [Das Zwei-Vertrags-Modell](#7-das-zwei-vertrags-modell)
8. [Determinismus als Vorbedingung von Evidenz](#8-determinismus-als-vorbedingung-von-evidenz)
9. [Das Schleifenprotokoll](#9-das-schleifenprotokoll)
10. [Sicherheitsarchitektur](#10-sicherheitsarchitektur)
11. [Dokumentation als Evidenzkette](#11-dokumentation-als-evidenzkette)
12. [Evaluation](#12-evaluation)
13. [Grenzen der Arbeit](#13-grenzen-der-arbeit)
14. [Übertragbarkeit](#14-übertragbarkeit)
15. [Fazit und weitere Arbeit](#15-fazit-und-weitere-arbeit)
16. [Literaturverzeichnis](#16-literaturverzeichnis)
17. [Anhang](#17-anhang)

---

## 1. Einleitung und Problemstellung

### 1.1 Der Ausgangspunkt

Ein CMS-Major-Upgrade ist eine der undankbarsten Aufgaben der Webentwicklung. Es ist teuer, es ist
riskant, und im Erfolgsfall bemerkt es niemand. Genau das ist das Qualitätskriterium: Ein
technisches Update ist dann gelungen, wenn Besucherinnen und Besucher nichts davon merken.

Diese Eigenschaft macht Migrationen zu einem idealen Anwendungsfall für Agenten — und zugleich zu
einem gefährlichen. Ideal, weil die Arbeit repetitiv, regelbasiert und gut dokumentiert ist.
Gefährlich, weil das Erfolgskriterium *Abwesenheit von Veränderung* ist, und Abwesenheit ist genau
das, was sich am leichtesten behaupten und am schwersten beweisen lässt.

### 1.2 Das Kernproblem: Der Agent bewertet sich selbst

In einer klassischen Testpyramide sind Testautor, Implementierer und Prüfinstanz getrennt. In einem
agentengesteuerten Lauf fallen alle drei zusammen. Der Agent schreibt die Änderung, führt das
Messwerkzeug aus, interpretiert dessen Ausgabe und formuliert das Ergebnis.

Diese Kette hat drei Stellen, an denen ein falsches Grün entstehen kann, ohne dass jemand lügt:

1. **Das Werkzeug kann nicht rot werden.** Ein Prüfschritt, der strukturell immer erfolgreich endet,
   ist von einem erfolgreichen Prüfschritt nicht unterscheidbar.
2. **Das Werkzeug misst Rauschen.** Wenn die Messung selbst nicht deterministisch ist, kann sie eine
   echte Regression nicht von ihrer eigenen Varianz trennen.
3. **Der Bericht entsteht aus dem Gedächtnis.** Wenn Zahlen aus dem Kontextfenster statt aus
   Artefakten stammen, sind sie plausibel, aber nicht belegt.

Alle drei traten im untersuchten Skill auf. Der erste war der schwerwiegendste und derjenige, den
die statische Analyse nicht finden konnte.

Kapitel 6 beantwortet dieses Problem im Zusammenhang: warum es zwei Defekte sind und nicht
einer, wie eine metamorphe Relation das Orakel umgeht, und was auch danach ungelöst bleibt.

### 1.3 Der zweite Zielkonflikt

Parallel zur Sicherheitsfrage besteht ein fachlicher Widerspruch, der in der Praxis ständig
auftritt. Die Auftraggeberseite formuliert typischerweise zwei Erwartungen gleichzeitig:

> „Das Update darf nichts kaputt machen."
> „Und danach soll die Seite schneller und besser sein."

Beide Sätze sind vernünftig. Zusammen in **einem** Arbeitsbereich sind sie unvereinbar: Jede
Verbesserung ist eine sichtbare Veränderung, und jede sichtbare Veränderung untergräbt den Nachweis,
dass das Update unsichtbar war. In der Praxis führt dieser Konflikt zu einem bekannten Muster —
Abweichungen werden nachträglich als „gewollt" umgedeutet, und die Grenze zwischen Regression und
Verbesserung verschwimmt genau dort, wo sie am wichtigsten wäre.

Diese Arbeit argumentiert, dass der Konflikt kein Abwägungsproblem ist, sondern ein
**Modellierungsfehler**: Zwei Ziele mit gegensätzlichen Erfolgskriterien gehören nicht in einen
Arbeitsbereich.

---

## 2. Forschungsfragen

**F1 — Nachweisbarkeit.** Unter welchen Bedingungen kann ein Agent glaubhaft nachweisen, dass eine
von ihm durchgeführte Migration für Endnutzer unsichtbar war?

**F2 — Zielkonflikt.** Wie lassen sich Invarianz („nichts verändern") und Verbesserung („besser
werden") in einem Prozess vereinen, ohne dass eines das andere entwertet?

**F3 — Schleifenstabilität.** Welche Struktur benötigt eine iterative Reparaturschleife, damit sie
konvergiert statt zu oszillieren, und wann ist Abbrechen der korrekte Ausgang?

**F4 — Sicherheitsgrenzen.** Wie lässt sich ein Agent, der Repositories, Datenbanken und laufende
Websites liest, gegen Prompt Injection und SSRF absichern, ohne die lokale Entwicklungsumgebung
unbrauchbar zu machen?

**F5 — Zustand.** Welche Persistenzform ist erforderlich, damit ein über mehrere Sitzungen laufender
Prozess wiederaufnehmbar und prüfbar bleibt?

---

## 3. Stand der Forschung und Praxis

### 3.1 Agent Skills und progressive Offenlegung

Anthropic führte Agent Skills mit *progressive disclosure* als zentralem Entwurfsprinzip ein: Ein
Skill wird in drei Stufen geladen — beim Start nur Name und Beschreibung (etwa 30–50 Token), bei
Aktivierung die vollständige `SKILL.md`, und erst bei Bedarf die referenzierten Dateien
[[1]](#lit1)[[2]](#lit2). Die Analogie zum menschlichen Gedächtnis ist explizit: Das Kontextfenster
ist Arbeitsspeicher, dessen Überladung die Leistung messbar verschlechtert.

Matt Pocock vertritt eine komplementäre Position: kleine, anpassbare, komponierbare Skills. Seine
Kritik richtet sich ausdrücklich gegen prozessbesitzende Frameworks, die „helfen, indem sie den
Prozess übernehmen — und dabei die Kontrolle nehmen und Fehler im Prozess schwer auffindbar machen"
[[3]](#lit3).

Für diese Arbeit ist die Spannung zwischen beiden Positionen zentral. Ein Migrationsprozess **ist**
prozessbesitzend: Die Reihenfolge der Phasen ist die Sicherheitsgarantie, nicht bloß eine Empfehlung.
Kapitel 14 argumentiert, dass die Auflösung nicht in der Wahl zwischen beiden liegt, sondern in der
Trennung zwischen dem, was zentral bleiben muss (der Vertrag), und dem, was ausgelagert werden kann
(die Prozedur).

### 3.2 Zuverlässigkeit über lange Horizonte

Die für diese Arbeit wichtigste Erkenntnis stammt aus der Forschung zu langlaufenden Agenten. Zwei
Befunde sind unmittelbar handlungsleitend.

**Fehlerkomposition.** Selbst eine kleine Fehlerrate pro Schritt akkumuliert über abhängige Schritte
und treibt Agenten von zuverlässiger Kurzaufgabenleistung zu nahezu systematischem Versagen bei
längeren Horizonten [[4]](#lit4)[[5]](#lit5). Eine Migration mit zwanzig Schleifen ist genau eine
solche Kette abhängiger Schritte.

**Self-Conditioning.** Enthält das Kontextfenster eines Modells dessen eigene frühere Fehler, steigt
die Wahrscheinlichkeit weiterer Fehler messbar. Ein falscher Schritt scheitert nicht isoliert — er
verschlechtert den epistemischen Kontext für jeden folgenden Schritt [[5]](#lit5).

Dieser zweite Befund ist die theoretische Begründung für zwei Entwurfsentscheidungen, die zunächst
kontraintuitiv wirken: dass eine Schleife nach zwei erfolglosen Iterationen **abbrechen** soll statt
weiterzuiterieren, und dass Vorbedingungen aus einer Datei statt aus dem Gesprächsverlauf gelesen
werden müssen. Beides begrenzt die Kontamination des Kontexts durch eigene Fehlversuche.

### 3.3 Prompt Injection und die tödliche Trias

Willison beschrieb 2025 die *lethal trifecta*: Zugang zu privaten Daten, Exposition gegenüber
untrusted content und die Fähigkeit zur externen Kommunikation. Je zwei davon sind beherrschbar;
alle drei in einer Sitzung erlauben es einer vergifteten Eingabe, Daten zu lesen und zu
exfiltrieren — ohne klassischen Exploit [[6]](#lit6).

Ein TYPO3-Migrationsagent erfüllt alle drei Kriterien im Normalbetrieb: Er liest die Datenbank
(private Daten), rendert Kundeninhalte und lädt Paketmetadaten (untrusted content) und stellt
HTTP-Anfragen (externe Kommunikation).

Die Abwehrlage ist ernüchternd. Eingabefilter, Instruktionshierarchien und feinjustierte
Klassifikatoren werden von adaptiven Angriffen zuverlässig umgangen; in einer Untersuchung von zwölf
theoretischen Abwehrmechanismen erreichten menschliche Red-Teamer eine Umgehungsrate von 100 %
[[7]](#lit7). Als tragfähig gelten architektonische Ansätze: CaMeL trennt Vorschlag und Ausführung,
indem eine deterministische Policy-Engine außerhalb des Modells entscheidet [[7]](#lit7).

Für diese Arbeit folgt daraus eine Gestaltungsregel, die in Kapitel 10 konkretisiert wird: Kein
verdiktproduzierender Codepfad darf ein Freitextfeld lesen. Die Abwehr liegt nicht darin, dem Modell
beizubringen, Injektionen zu erkennen, sondern darin, dass die Entscheidung nicht am Text hängt.

### 3.4 Determinismus in der visuellen Regression

Die Praxisliteratur benennt konsistent dieselben Flakiness-Quellen: Animationen, die zu
unterschiedlichen Frames erfasst werden; Schriften, die je nach Umgebung anders rendern; sowie
Zeitstempel, Werbung und nutzerspezifische Daten, die zwischen Läufen variieren [[8]](#lit8)[[9]](#lit9).

Als Gegenmaßnahmen gelten das Stummschalten von Animationen, deterministisches Seeding von Daten,
CSS-basiertes Maskieren dynamischer Elemente und das Erzwingen eines einheitlichen Device Scale
Factors [[8]](#lit8)[[9]](#lit9).

Die vorliegende Arbeit ergänzt diesen Katalog um zwei Elemente, die in der gesichteten Literatur
nicht prominent auftreten und sich in der Praxis als besonders wirksam erwiesen:

- **Seeding von `Math.random` pro Aufnahme.** Rotierende Teaser, gemischte Listen und generierte
  Element-IDs sind mit CSS nicht stabilisierbar. Sie sind die häufigste verbleibende Flakiness-Quelle,
  nachdem Animationen abgeschaltet wurden.
- **Eine angehaltene, aber fortschreitende Uhr.** Ein hartes Einfrieren von `Date.now()` erzeugt
  Division durch null in realem Code und bricht Bibliotheken, die auf verstrichene Zeit warten. Ein
  fixer Ursprung plus monotoner Zähler ist stabil und bleibt lauffähig.

### 3.5 Labor- versus Felddaten

Für den Verbesserungsteil ist die Unterscheidung zwischen Labor- und Felddaten entscheidend. INP ist
eine reine Feldmetrik und in Laborwerkzeugen wie Lighthouse nicht messbar, da sie echte
Nutzerinteraktion voraussetzt [[10]](#lit10)[[11]](#lit11).

Lighthouse verwendet Total Blocking Time als Näherung — mit einer bekannten Einschränkung: Eine
Seite kann 0 ms TBT erreichen und im Feld dennoch bei INP durchfallen, weil JavaScript die Seite
blockiert, wenn Nutzer *nach* dem Laden interagieren [[11]](#lit11). Der Web Almanac 2025 weist aus,
dass 52 % der mobilen Websites im Feld mindestens einen Core Web Vital verfehlen — viele davon mit
unauffälligen Laborwerten [[11]](#lit11).

Daraus folgt eine Berichtsregel, die in Kapitel 7.4 formalisiert wird: Ein lokal gemessener
Absolutwert darf niemals als Feldergebnis dargestellt werden, und „INP bestanden" darf aus
Labordaten nicht behauptet werden.

---

## 4. Methodik

### 4.1 Untersuchungsdesign

Die Untersuchung kombinierte drei Verfahren:

**Statische Analyse (extern).** Eine unabhängige Tiefenanalyse bewertete Skill-Dokument, Skripte,
Phasen und Quality Gates. Sie erklärte ihre eigene Grenze ausdrücklich: „Es handelt sich um eine
statische Analyse. Die Skripte wurden nicht gegen ein echtes TYPO3-Projekt ausgeführt."

**Unabhängige Codeverifikation.** Jeder Befund wurde gegen den Quelltext geprüft, mit Zeilenbezug.
Zusätzlich wurden die Ausführungspfade verfolgt — insbesondere die Frage, welcher Wert am Ende
tatsächlich den Prozess-Exit-Code bestimmt.

**Adversariale Prüfung der Analyse selbst.** Die externe Analyse wurde nicht als Autorität
behandelt. Zwei ihrer Empfehlungen wurden nach Prüfung modifiziert übernommen (Kapitel 5.4).

### 4.2 Warum die dritte Stufe notwendig war

Der zentrale methodische Befund dieser Arbeit ist, dass die statische Analyse den schwerwiegendsten
Defekt nicht finden konnte — nicht aus Unachtsamkeit, sondern aus Prinzip.

Die Analyse las die Vergleichsfunktion und stellte korrekt fest, dass sie Unterschiede erkennt,
klassifiziert und in einen Bericht schreibt. Alles daran war richtig. Was sie nicht prüfte, war die
Frage, ob dieses korrekte Ergebnis jemals den Prozess-Exit-Code erreicht. Das tat es nicht.

Daraus folgt eine verallgemeinerbare Methodenregel:

> **Eine statische Analyse prüft, ob Code das Richtige berechnet. Sie prüft nicht, ob das Ergebnis
> irgendwo ankommt. Bei Prüfwerkzeugen ist die zweite Frage die wichtigere.**

### 4.3 Verifikationsstand

Sämtliche in Kapitel 5 berichteten Codebefunde wurden am Quelltext verifiziert. Die
Sicherheitsmodule der Neuimplementierung sind durch 53 Unit-Tests abgedeckt, die gegen einen
lokalen Fixture-Server und einen injizierbaren DNS-Resolver laufen. Kein Test benötigt Netzwerk.

Nicht verifiziert: das Verhalten gegen ein reales TYPO3-Projekt. Kapitel 13 behandelt diese Grenze.

---

## 5. Befunde

### 5.1 Bestätigte Befunde der externen Analyse

Alle wesentlichen Befunde wurden am Code bestätigt:

| Bereich | Befund | Bewertung |
|---|---|---|
| SSRF | Sitemap-Rekursion ohne Visited-Set, Tiefenbegrenzung, Dokumentgrenze, Größenbeschränkung und Origin-Prüfung | kritisch |
| Credentials | Backend-Zugangsdaten folgen Redirects ohne Origin-Prüfung | kritisch |
| Browser | `--disable-web-security`, `--no-sandbox` als Standard | kritisch |
| Secrets | Automatisches Laden von `.env` aus dem **Skill**-Verzeichnis | hoch |
| Reproduzierbarkeit | `sort(() => Math.random() - 0.5)` als Stichprobenverfahren | hoch |
| Prompt Injection | Keine Vertrauenshierarchie | hoch |
| Toleranz | Prozentuale „minor"-Schwelle als bestandenes Ergebnis | hoch |
| Abdeckung | Backend-Module als `skipped` markiert, Lauf dennoch grün | hoch |

Das Stichprobenverfahren verdient eine Randbemerkung: `sort(() => Math.random() - 0.5)` ist nicht
nur unseeded und damit nicht reproduzierbar, sondern auch statistisch verzerrt. Die resultierende
Verteilung hängt von der Sortierimplementierung ab. Der Skill dokumentierte seine Stichprobe als
„zufällig, aber reproduzierbar" — sie war weder das eine noch das andere.

### 5.2 Der Befund, den die statische Analyse nicht erreichte

Drei der fünf Harness-Aktionen — `compare-screenshots`, `smoke-test` und `lighthouse-test` — gaben
unter keinen Umständen einen von null verschiedenen Exit-Code zurück.

Die Kette im Detail:

1. Die Vergleichsfunktion erkennt Unterschiede korrekt.
2. Sie schreibt einen korrekten JSON-Bericht.
3. Sie protokolliert eine korrekte Zusammenfassung.
4. Sie gibt **nichts** zurück.
5. `main()` erreicht `logger.success('Action completed successfully')`.
6. Der Prozess endet mit Exit-Code 0.

Ein Lauf mit vierzig abweichenden Screenshots war von einem perfekten Lauf nicht unterscheidbar —
für CI, für die Schleife und für jedes Completion Gate.

Das ist kein Logikfehler in der Vergleichsfunktion. Es ist ein **fehlendes Verbindungsstück** zwischen
korrektem Ergebnis und beobachtbarem Resultat. Genau diese Klasse von Defekt entzieht sich der
Codelektüre, weil jede einzelne Funktion beim Lesen korrekt wirkt.

Bemerkenswert ist der Kontrast innerhalb desselben Repositories: Das Backend-Sweep-Skript setzte
seinen Exit-Code korrekt. Die Konvention war also bekannt — sie war nur an drei Stellen nicht
angewandt worden.

### 5.3 Weitere unabhängig gefundene Defekte

- **Schema-Hartkodierung.** Die Sitemap-Zielbildung entfernte das Protokoll der übergebenen URL und
  setzte fest `https://` ein. Ein `http://`-DDEV-Projekt fand null URLs — und da Fetch-Fehler zu
  Warnungen herabgestuft wurden, konnte die Discovery „erfolgreich" mit ausschließlich Golden-Path-
  URLs enden.
- **Einseitiger Verzeichnisdurchlauf.** Der Vergleich iterierte nur über das *Vorher*-Verzeichnis.
  Eine Seite, die nach dem Update *mehr* Inhalt renderte, erzeugte eine Datei, die nie betrachtet
  wurde. Das Werkzeug war blind für genau die Richtung von Veränderung, die eine hinzugefügte
  Fehlermeldung oder ein doppelt gerendertes Element erzeugt.
- **Dokumentierter, nicht existenter Standardwert.** Die Referenz beschrieb für die Erkennung
  kaputter Seiten eine „(built-in list)". Der Code setzte ein leeres Array. Der Smoke-Test erkannte
  ohne Zutun des Aufrufers **nichts** — und meldete Erfolg.
- **Generische Empfehlungen als Messergebnisse.** Der Lighthouse-Bericht wurde mit fünf fest
  kodierten Empfehlungen aufgefüllt, wenn weniger gemessene vorlagen. Diese erreichten den
  KPI-Bericht ununterscheidbar von tatsächlich gemessenen Befunden.

Die letzten beiden gehören zu einer gemeinsamen Klasse: **Dokumentation und Implementierung
divergieren, und die Divergenz erzeugt falsches Vertrauen statt eines Fehlers.**

### 5.4 Abweichungen von den Empfehlungen der externen Analyse

Zwei Empfehlungen wurden nach Prüfung modifiziert übernommen.

**Vollständige Screenshot-Abdeckung.** Die Analyse forderte visuelle Prüfung *aller* öffentlich
erreichbaren URLs. Das Ziel ist richtig, die Operationalisierung skaliert jedoch nicht: 5.000 URLs
× 3 Viewports = 15.000 Aufnahmen pro Lauf, mehrfach je Schleife.

Übernommen wurde stattdessen eine gestufte Beweisführung, die den Anspruch erfüllt, ohne ihn zu
verwässern: **100 % der URLs auf HTTP- und DOM-Ebene** — beides ist günstig und fängt die Mehrzahl
der Regressionen —, Pixelvergleich für Tier-1-Seiten sowie Repräsentanten jedes Template-Clusters,
und **namentliche Nennung jeder nicht pixelverglichenen URL mitsamt Grund**. Die Cluster-Signatur
fällt beim DOM-Vergleich ohnehin an.

Der entscheidende Punkt ist nicht die Stichprobe, sondern die Ehrlichkeit: Ein Bericht, der 60 % der
Website abgedeckt hat und exakt so klingt wie einer, der alles abgedeckt hat, ist schlimmer als kein
Bericht.

**Blockade privater IP-Bereiche.** Die Analyse forderte, private, Loopback- und Link-local-Adressen
zu blockieren. Wörtlich umgesetzt hätte das den Skill unbrauchbar gemacht: Ein DDEV-Projekt löst
definitionsgemäß auf `127.0.0.1` auf. Kapitel 10.2 beschreibt die stattdessen entwickelte Auflösung.

---

## 6. Die Auflösung der Selbstbeurteilung

Kapitel 1.2 stellt das Kernproblem: Der Agent, der die Änderung durchführt, ist zugleich die
Instanz, die ihren Erfolg beurteilt. Hängt die Messung an derselben Kette wie die Änderung,
ist ein grünes Ergebnis eine Behauptung, kein Beweis.

Dieses Kapitel beantwortet das. Die einzelnen Mechanismen erscheinen anschließend in den
Kapiteln 7 bis 11 als Konstruktionsentscheidungen; hier stehen sie als das, was sie sind —
fünf voneinander unabhängige Wege, Zirkularität zu verkleinern — samt einer ehrlichen Angabe
dessen, was ungelöst bleibt.

### 6.1 Zwei Defekte, nicht einer

Der erste Defekt ist alt und hat einen Namen: das **Orakelproblem**. Für eine migrierte
Website lässt sich nicht angeben, wie die korrekte Ausgabe aussieht. Es gibt keine Instanz,
die "richtig" definiert.

Der zweite Defekt ist neu: Die Partei, die das Orakel liefern müsste, ist die Partei, über
die geurteilt wird. Das ist kein Erkenntnisproblem, sondern ein **Interessenkonflikt**.

Beide zusammen erklären, warum "mehr Tests schreiben" nicht hilft. Mehr Tests, geschrieben
von derselben Instanz, gegen dieselbe Erwartung, vergrößern die Zirkularität, statt sie
aufzulösen. Die beiden Defekte brauchen getrennte Gegenmittel.

### 6.2 Erste Auflösung: metamorphe Relation statt Orakel

Die tragende Idee dieser Arbeit ist, das Orakel nicht zu beschaffen, sondern zu **umgehen**.

Wir können nicht sagen, wie die migrierte Seite aussehen *soll*. Wir können aber eine Relation
zwischen zwei Läufen angeben:

> Gleiche Daten + gleiche Konfiguration + gleiche Anfrage + gleiche Browserumgebung
> ⟹ gleiche Ausgabe.

Das ist eine **metamorphe Relation**: eine Aussage über das Verhältnis zweier Ausführungen,
die kein Wissen über die korrekte Ausgabe voraussetzt. Metamorphes Testen ist genau die
Antwort der Testforschung auf das Orakelproblem, und Vertrag A ist ein Anwendungsfall davon.

Daraus folgt eine Umdeutung, die dem Zwei-Vertrags-Modell erst sein Fundament gibt: Die
Forderung, dass ein Update unsichtbar sein muss, ist **kein ästhetisches, sondern ein
prüftechnisches Kriterium**. Ein Update, das sichtbar verändern darf, hat weder ein Orakel
noch eine Relation — und ist damit **prinzipiell** nicht verifizierbar, nicht bloß praktisch
schwer. Vertrag B existiert nicht, weil Verbesserungen unerwünscht wären, sondern weil sie
außerhalb der einzigen Relation liegen, die wir prüfen können; sie brauchen deshalb eine
eigene, ausdrücklich genehmigte Vergleichsgrundlage.

Der Preis ist real und gehört benannt: Die Relation belegt **Invarianz, nicht Korrektheit**.
Eine Seite, die vorher kaputt war, ist nachher gleich kaputt und besteht den Test. Genau
dafür existiert die Befundklasse `pre-existing` — sie macht diese Lücke sichtbar, statt sie
zu schließen.

### 6.3 Zweite Auflösung: der Nulllauf als bekannte Wahrheit

Eine Relation ist nur so viel wert wie das Instrument, das sie misst — und das Instrument
gehört wieder dem Agenten. Der Ausweg ist ein Fall, dessen Antwort **vorab feststeht**.

Loop 000 nimmt die unveränderte Website zweimal auf. Zwischen beiden Durchgängen ist nichts
geschehen; die korrekte Antwort ist daher notwendigerweise null. Das ist keine Prüfung,
sondern eine **Kalibrierung** gegen eine Wahrheit, die niemand beurteilen muss.

Der Agent kann dieses Ergebnis nicht wegargumentieren. Er kann es nur bestehen oder das
Instrument reparieren. Deshalb ist das Verbot, den Nulllauf durch Schwellenanhebung oder
Stichprobenverkleinerung zu bestehen, kein Formalismus: Es ist die einzige Stelle im
Verfahren, an der Grundwahrheit ohne Richter verfügbar ist.

### 6.4 Dritte Auflösung: zeitliche Trennung und Versiegelung

Selbstbeurteilung äußert sich in der Praxis selten als Lüge. Sie äußert sich als
**nachträgliche Anpassung des Maßstabs**.

Die Gegenmaßnahme ist zeitlich: Die Vergleichsgrundlage wird versiegelt, bevor die erste
Änderung erfolgt — `MANIFEST.sha256`, `LOCK.json`, beides mit Fingerabdrücken der Umgebung
und der Inhalte. Der Maßstab des Richters steht fest, bevor der Beurteilte handelt.

Das Re-Baselining-Verbot aus Regel 20 ist damit keine Stilfrage, sondern die Bedingung dafür,
dass die Relation aus 6.2 überhaupt etwas aussagt. Eine Baseline, die man verschieben kann,
ist keine Relation, sondern eine Meinung.

### 6.5 Vierte Auflösung: Kanaltrennung

Ein Urteil muss einen Kanal erreichen, den der Agent nicht in Prosa verfasst.

Der empirische Fall dieser Arbeit ist der Exit-Code-Defekt aus Kapitel 5.2: Die
Vergleichsfunktion erkannte die Unterschiede korrekt, schrieb einen korrekten Bericht,
protokollierte eine korrekte Zusammenfassung — und gab nichts zurück. Vierzig kaputte Seiten
endeten mit Exit-Code 0. Rechnung richtig, Kanal fehlt.

Daraus folgen zwei Regeln, die inzwischen technisch durchgesetzt sind. Erstens: Exit-Codes,
schemavalidierte Berichte, maschinenlesbare Gates. Zweitens, schärfer: **Kein
verdiktproduzierender Codepfad liest ein Freitextfeld.** Geprüft wird das, indem der
eingeschleuste Text mutiert und geprüft wird, dass das Verdikt byteweise identisch bleibt.
Damit ist die Prosa des Agenten für das Ergebnis strukturell folgenlos.

### 6.6 Fünfte Auflösung: Zustand außerhalb des Kontextfensters

Vorbedingungen werden aus `state.json` gelesen, nie aus dem Gesprächsverlauf.

Das folgt unmittelbar aus dem Self-Conditioning-Befund [[5]]: Enthält das Kontextfenster die
eigenen Fehlversuche, steigt die Fehlerwahrscheinlichkeit. Das Kontextfenster ist genau der
Ort, an dem sich selbstdienliche Drift ansammelt — also ist es die schlechteste verfügbare
Wahrheitsquelle über den eigenen Fortschritt.

Append-only-Journal und eingefrorene Dokumente ergänzen das: Eine nachträglich geschönte
Historie wird im Git-Diff sichtbar. Evidenz, die man unbemerkt ändern kann, ist keine.

### 6.7 Ein Detektor für Zirkularität

Die vorstehenden fünf Mechanismen verkleinern Zirkularität. Keiner **misst** sie. Aus der
Eval-Arbeit dieser Arbeit ergab sich unerwartet ein Verfahren dafür.

Die generierten Eval-Fälle — aus den Skill-Beschreibungen abgeleitet — bestanden **häufiger**
als die handgeschriebenen: 87 % gegen 78 %. Das wirkt verkehrt, bis man den Grund sieht: Ein
abgeleiteter Fall prüft eine Beschreibung gegen ihr eigenes Vokabular. Er ist zirkulär und
deshalb leicht. Nachdem die echten Lücken behoben waren, kehrte sich das Verhältnis um: 89 %
gegen 100 %.

Eine spätere Prüfung des Bestands zeigte, dass die Zirkularität nicht subtil war, sondern
wörtlich. Von 132 generierten Fällen waren **alle** entartet: 88 waren wörtliche Teilzeichen-
ketten der eigenen `SKILL.md` — der Generator hatte Beschreibungen an Kommata zerlegt und die
Bruchstücke als Prompts verwendet ("Building", "Content elements", "Axe-core") —, 22 waren
unausgefüllte `TODO:`-Platzhalter, 22 dieselbe kopierte Negativprobe. Die 89 % maßen nichts;
sie maßen `prompt in description`. Damit wird der Detektor billiger als gedacht: Wo die
Ableitung wörtlich ist, genügt ein Teilstring-Test, und genau der läuft jetzt maschinell
gegen jeden Fall, den ein Mensch unterschreiben soll.

Beim vollständigen Austausch aller 132 Fälle trat ein Effekt hinzu, den nur die
Gesamtmessung zeigt: **Beschreibungen sind nicht unabhängig.** Die IDF-Gewichtung wird über
den gesamten Korpus berechnet, also verschob die Überarbeitung von dreizehn Beschreibungen
die Werte unberührter Skills mit. Zwei bereits unterschriebene Fälle fielen dadurch aus,
ohne dass an ihren Skills etwas geändert worden wäre. Eine Prüfung je Skill kann das nicht
finden; nur der Lauf über die ganze Sammlung findet es.

Der erste Ersatzstapel bestätigte die Vorhersage quantitativ. 16 neu geschriebene Fälle für
ein Skillpaar erreichten im ersten Lauf **50 %**, während die entarteten Fälle desselben
Bestands bei 91 % lagen. Jeder Fehlschlag war diagnostisch, und keiner lag am Fall: Eine
Beschreibung eröffnete mit "Audits …" und beanspruchte damit das Verb des Nachbarskills;
eine andere kannte "focus states", während Nutzer "focus outline" und "tab" tippen; eine
dritte enthielt die Wörter "skip link" und "landmark" überhaupt nicht. Korrigiert wurden die
**Beschreibungen**, nicht die Fälle — Ergebnis 100 %, und die lexikalische Überlappung des
Paares fiel von 0,120 auf 0,088.

Verallgemeinert:

> **Übertreffen Tests, die aus dem Artefakt abgeleitet wurden, systematisch Tests, die
> unabhängig davon geschrieben wurden, ist die Testsuite zirkulär.**

Der Vergleich ist billig, automatisierbar und liefert eine Zahl statt eines Gefühls. In den
gesichteten Quellen kommt er nicht vor; er ist der eigenständigste methodische Beitrag dieses
Kapitels.

### 6.8 Was ungelöst bleibt

Nichts davon macht den Agenten zu einer unabhängigen Instanz. Es verkleinert die Fläche, auf
der Selbstbeurteilung schiefgehen kann. Drei Reste bleiben:

**Der Agent wählt, was gemessen wird.** Metamorphe Relation, Stichprobe, Viewport-Matrix,
Zustandsliste — alles Entscheidungen des Beurteilten. Eine Regression außerhalb des
Gemessenen bleibt unsichtbar, und die deklarierte Abdeckung ist die einzige Gegenmaßnahme.

**Der Agent schreibt die Testfälle.** Deshalb die Trennung `draft` gegen `reviewed`: Nur ein
menschlich gegengezeichneter Fall zählt als Abdeckung. Das ist wirksam und teuer, und es ist
der einzige Punkt, an dem echte Unabhängigkeit ins Verfahren kommt.

**Der Agent setzt die Schwellen.** Gegenmaßnahme ist die Ratsche: Schwellen stehen auf den
gemessenen Werten, nicht auf Wunschwerten, sodass jede Verschlechterung ein Fehlschlag ist
und kein langsames Abrutschen.

Am deutlichsten wurde die Lehre, als der Zirkularitätswächter seinen eigenen Autor fasste.
Beim Anreichern der Beschreibungen um Nutzervokabular geriet ein Satz wörtlich in eine
Beschreibung, der zugleich als Eval-Prompt diente — die Beschreibung wurde auf den Test hin
geschrieben. Die Wortlautregel fand einen Fall; eine anschließende Prüfung fand vier weitere
Teilechos von sieben bis zehn Wörtern, darunter eines in einer bereits unterschriebenen
Suite. Die Regel lautet jetzt: kein Lauf von mehr als sechs aufeinanderfolgenden Wörtern
gemeinsam mit der eigenen `SKILL.md`, wobei die Sechs aus den Daten stammt — über 90
handgeschriebene Fälle liegt der Median bei zwei Wörtern. Ein Wächter, der nur die grobe
Form seines Fehlers kennt, übersieht die feine.

Und, weil dieselbe Prüfung ein zweites Mal fündig wurde: Die Negativfälle waren als
`skill not in top[:1] and best_score > 0` formuliert. Beide Hälften waren falsch. "Dieses
Skill ist nicht Platz 1" ist für 21 der 22 Suiten, die denselben Fall führen, trivial
erfüllt — die Prüfung konnte nicht scheitern. Und `best_score > 0` **verlangte** einen
Treffer, sodass ein Prompt, der korrekt nichts trifft, durchgefallen wäre. Gemessen ordnete
eine Python-Dateiumbenennung `typo3-v14-reference` mit 3,44 ein, und der Test, der genau das
verhindern sollte, meldete Erfolg. Nach der Korrektur — *nichts darf wie ein echter Treffer
punkten*, Schwelle aus den Daten abgeleitet statt gewählt — fiel die Quote der
unterschriebenen Fälle von 100 % auf 97 %: Ein signierter Fall hatte folgenlos bestanden.
Das ist derselbe Defekt wie der Exit-Code aus 6.5, eine Ebene höher: eine Prüfung, die nicht
rot werden kann, misst nichts.

Und eine Lehre, die diese Arbeit sich selbst erteilt hat: **Man repariere das Instrument,
bevor man ihm glaubt.** Als die Trigger-Evals zuerst 60 % ergaben, lag die Hälfte der Lücke
am Messverfahren — eine Bewertungsfunktion, die lange Beschreibungen bestrafte, und ein
fehlender Wortstamm-Abgleich. Die naheliegende Lesart wäre "unsere Beschreibungen sind
schlecht" gewesen. Sie wäre zur Hälfte falsch gewesen, und die Korrektur hätte an der
falschen Stelle angesetzt.

## 7. Das Zwei-Vertrags-Modell

### 7.1 Der Entwurf

Der Konflikt aus Kapitel 1.3 wird aufgelöst, indem die beiden Ziele in sequentielle Verträge zerlegt
werden.

**Vertrag A — Invarianz.**

> Gleiche Daten + gleiche Konfiguration + gleiche Anfrage + gleiche Browserumgebung müssen vor und
> nach dem Update dieselbe Frontend-Ausgabe erzeugen.

Null unerklärte Abweichungen gegen eine Baseline, die **vor jeder Änderung** eingefroren wurde.

**Vertrag B — Elevation.** Performance, SEO, Barrierefreiheit, Sicherheitshärtung. Beginnt
ausschließlich nach nachweislichem Abschluss von Vertrag A, mit eigener Genehmigung und eigener
abgeleiteter Baseline je Arbeitsstrang.

### 7.2 Warum die Reihenfolge nicht verhandelbar ist

Der ursprüngliche Skill erfasste die Baseline **nach** dem Bootstrap-Update und **nach** der
Barrierefreiheitsschleife. Beide verändern Markup und CSS.

Die Konsequenz ist strukturell und nicht durch Sorgfalt heilbar: Was diese beiden Schritte
zerbrochen haben, kann durch keine spätere Messung mehr sichtbar gemacht werden. Es ist Teil der
Vergleichsgrundlage geworden.

Das gilt auch für den intuitiv naheliegenden Fall, die Sitemaps zuerst zu reparieren — schließlich
sind sie die Stichprobenquelle. Die Regel lautet dennoch: **erst versiegeln, dann reparieren.** Sind
die Sitemaps unbrauchbar, wird die Stichprobe aus einem Seitenbaum-Crawl abgeleitet, per ADR
dokumentiert und *diese* versiegelt.

> Eine Änderung, die vor der Existenz der Baseline erfolgt, ist eine Änderung, die niemand jemals
> prüfen kann.

### 7.3 Null als einzig verteidigbarer Zielwert

Der ursprüngliche Harness behandelte Abweichungen unterhalb eines Prozentwerts als „minor" und ließ
sie passieren. Das wurde ersatzlos entfernt.

Die Begründung ist geometrisch, nicht ideologisch: Bei einem Full-Page-Screenshot einer langen Seite
umfasst ein Prozentwert sehr viele Pixel. Ein fehlender Button oder ein verschobenes Modul passt
bequem in „1 %". Ein Prozentwert misst **Fläche, nicht Bedeutung**.

Der Prozentwert bleibt als Datum im Bericht. Er entscheidet kein Verdikt mehr.

An seine Stelle tritt eine verpflichtende Klassifikation jeder Abweichung in sieben Klassen. Zwei
davon sind entwurfsseitig bemerkenswert:

- **`harness-noise`** schließt einen Befund nicht, sondern *verschiebt* ihn. Die Schleife bleibt
  blockiert, und die fehlende Stabilisierung geht an den Selbsttest zurück. Ohne diese Regel wird
  „das ist nur Rauschen" zum universellen Entsorgungsweg.
- **`improvement`** existiert als legaler Ausgang für die Versuchung. Ein Agent, der während der
  Migration eine echte Verbesserungsmöglichkeit erkennt, braucht einen Ort dafür, der nicht „jetzt
  gleich machen" heißt.

### 7.4 Ehrlichkeit bei lokalen Messwerten

Vertrag B misst in DDEV. Jede Kennzahl trägt daher ihren Vorbehalt **neben der Zahl**, nicht in
einer Fußnote:

| Kennzahl | Vorbehalt |
|---|---|
| Lighthouse-Scores | Indikativ. Lokales Netz, warme Caches. Die *Verbesserung* ist die Evidenz. |
| TBT | Ausdrücklich als INP-**Näherung** gekennzeichnet. „INP bestanden" ist aus Labordaten nicht behauptbar [[11]](#lit11). |
| TTFB | Lokal unrealistisch niedrig; nicht übertragbar. |
| HSTS | Lokal vorhanden, nur auf der Produktionsschicht wirksam. |
| Observatory-Note | Offline aus dem Header-Set berechnet, nicht von Mozilla ausgestellt. |
| AVIF-Anteil | Abhängig vom lokalen Bildprozessor; Produktion kann abweichen. |

CLS ist die am besten übertragbare der drei Vitals — eine lokale CLS-Regression ist eine echte
Regression.

---

## 8. Determinismus als Vorbedingung von Evidenz

### 8.1 Der Selbsttest

Vor Erstellung jeder Baseline wird die **unveränderte** Website zweimal aufgenommen und verglichen.
Anforderung: null Abweichungen.

Der Kern des Arguments ist logisch, nicht technisch: Zwischen den beiden Durchläufen hat sich
nichts geändert. Jede Abweichung ist daher notwendigerweise eine Eigenschaft der **Messung**.

Daraus folgt eine Regel, die in der gesichteten Literatur so nicht formuliert ist:

> **Nur ein Messwerkzeug, das gegen sich selbst null beweist, darf über eine Migration urteilen.**

Mechanisch durchgesetzt: Jeder `compare-*`-Befehl verweigert die Ausführung ohne gültigen
Selbsttest-Lock.

### 8.2 Was ausdrücklich verboten ist

Der Selbsttest hat drei naheliegende Umgehungen, und alle drei sind untersagt:

- die Stichprobe verkleinern
- eine Schwelle anheben
- eine Seite ohne ADR ausschließen

Jede zerstört exakt die Fähigkeit, deretwegen der Test existiert: eine echte Regression vom eigenen
Rauschen zu unterscheiden. Ein Werkzeug, das seinen eigenen Test durch Absenken des Anspruchs
besteht, hat den Test nicht bestanden, sondern abgeschafft.

### 8.3 Diagnose nach Fehlerform

Der Selbsttest ist erst nützlich, wenn sein Ergebnis handlungsleitend ist. Die Zuordnung erfolgt
über die Form der Abweichung:

| Was abweicht | Fast immer |
|---|---|
| Datums-/Zeitähnlicher Text | Uhr nicht angehalten |
| Teaser- oder Slide-Reihenfolge | `Math.random` nicht geseedet |
| Gesamtes Layout horizontal verschoben | Scrollbar-Gutter |
| Erster Bildschirm korrekt, unterer Teil leer | Lazy Loading nicht abgeschlossen |
| Subtil andere Buchstabenformen | Schriften nicht vollständig geladen |
| Ein Bild abweichend, andere korrekt | `_processed_` während der Aufnahme erzeugt |
| Alles leicht abweichend | Umgebungsdrift → **`INVALID`**, kein Stabilisierungsproblem |

Die letzte Zeile ist die wichtigste. Sie unterscheidet ein Werkzeugproblem von einem Datenproblem
und verhindert, dass ein Browser-Update als Website-Regression missgedeutet wird.

### 8.4 Zwei Fingerabdrücke

**Umgebungsfingerabdruck** — Chromium, Playwright, Node, Betriebssystem-Image, Schriftenliste,
Device Scale Factor, Locale, Zeitzone, Farbschema, Bildprozessor samt TYPO3-`GFX`-Konfiguration, PHP,
TYPO3, DDEV, Lockfile-Hash. Bewusst *nicht* gehasht: CPU-Anzahl, Speicher, Hostname, Uptime — sie
variieren legitim.

**Inhaltsfingerabdruck** — Zeilenzahlen und `tstamp`-Maxima der inhaltstragenden Tabellen plus ein
Baum-Hash über `fileadmin`. Ausgeschlossen sind selbstverändernde Tabellen wie `sys_log` und
Session-Tabellen.

Der zweite Fingerabdruck adressiert einen in der Praxis teuren Fall: Eine Redakteurin speichert
während des Laufs ein Inhaltselement im lokalen Backend. Ohne Fingerabdruck sieht das exakt aus wie
eine Update-Regression, und die Suche danach kostet einen Tag.

Beide Drifts erzeugen `INVALID`, niemals `FINDINGS`. Diese Unterscheidung ist keine Kosmetik: Sie
ist die Differenz zwischen „die Website ist kaputt" und „die Messung ist ungültig".

---

## 9. Das Schleifenprotokoll

### 9.1 Ein Protokoll statt vieler

Der ursprüngliche Skill beschrieb fünf Schleifen — visuelle Hauptschleife, Bootstrap-Mini-Schleife,
Barrierefreiheitsschleife, Feature-Schleife, Lighthouse-Schleife — jede in eigener Sprache, keine
mit Zähler, Iterationsbudget oder Abbruchbedingung. Der einzige Haltepunkt war das Completion Gate.

Ersetzt durch **ein** Protokoll in zwölf Schritten, das jede Schleife instanziiert.

### 9.2 Die stabilitätsrelevanten Elemente

**Eine Ursache pro Iteration, mit Änderungsbudget** (≤ 10 Dateien oder ≤ 400 Zeilen). Werden zwei
Ursachen gleichzeitig behoben, zerstört das die Zuordnung, die die nächste Messung interpretierbar
macht. Zwei Fehlerbehebungen können einander sogar aufheben.

**Fortschrittsanforderung.** Nach jeder Iteration muss die Zahl offener Befunde *strikt* sinken.
Gleichstand ist eine Nicht-Fortschritts-Iteration.

**Abbruchmatrix.** Maximale Iterationszahl, zwei Nicht-Fortschritts-Iterationen, Oszillation
(ein Befund, der einmal wieder aufgeht), Fingerabdruck-Drift, Zeitbudget, Budgetüberschreitung,
nicht klassifizierbarer Befund.

**Idempotenz-Nachlauf.** Nach Erreichen aller Exit-Kriterien wird die Messung unverändert wiederholt.
Eine grüne Schleife, die nicht idempotent ist, ist nicht grün — sie ist `harness-noise`.

### 9.3 Warum Abbrechen ein korrekter Ausgang ist

Diese Entwurfsentscheidung folgt unmittelbar aus Kapitel 3.2. Wenn das Kontextfenster eines Modells
seine eigenen Fehlversuche enthält und dies die Wahrscheinlichkeit weiterer Fehler messbar erhöht
[[5]](#lit5), dann ist fortgesetztes Iterieren nach zwei erfolglosen Versuchen nicht nur
unwirtschaftlich, sondern **aktiv schädlich**. Jeder weitere Fehlversuch verschlechtert die
Bedingungen für den nächsten.

> Eine Schleife, die nach sechs Iterationen anhält und präzise benennt, was sie nicht auflösen
> konnte, ist mehr wert als eine, die zwanzig Iterationen lang oszilliert.

Der Abbruch stellt den Snapshot wieder her, schreibt das Verdikt und eskaliert mit konkreter
Evidenz. Er ist der Übergabepunkt an einen Menschen — nicht ein Fehlschlag des Prozesses, sondern
sein vorgesehener Ausgang für den Fall, dass die Automatisierung ihre Grenze erreicht.

### 9.4 Die Triage-Tabelle

Ein Nebeneffekt der dreistufigen Beweisführung ist erhebliche Diagnosebeschleunigung. Die Stufe, die
eine Abweichung zuerst erfasst, engt die Ursache bereits ein:

| HTTP | DOM | Pixel | Ursachenklasse |
|---|---|---|---|
| ✗ | ✗ | ✗ | Routing, Redirects, Site-Konfiguration |
| ✓ | ✗ | ✗ | Fluid, TypoScript, Extension-Markup |
| ✓ | ✓ | ✗ | CSS, Assets, Schriften, Bildverarbeitung |

Das verwandelt eine lange Pixelsuche in eine kurze gezielte Prüfung — und ist der Grund, die Stufen
in dieser Reihenfolge auszuführen.

---

## 10. Sicherheitsarchitektur

### 10.1 Der Exit-Code-Vertrag

Sechs Codes, weil sechs unterschiedliche Reaktionen erforderlich sind:

| Code | Bedeutung | Reaktion |
|---|---|---|
| 0 | bestanden | weiter |
| 1 | Befunde | **Website reparieren** |
| 2 | Werkzeugfehler | **Werkzeug reparieren** |
| 3 | ungültig | **anhalten — nicht beurteilbar** |
| 4 | Vorbedingung offen | Vorbedingung erfüllen |
| 5 | durch Policy blockiert | **untersuchen** |

Die beiden zusätzlichen Codes sind die eigentliche Aussage dieses Kapitels:

**3 ist nicht 1.** Ein Chromium-Update zwischen Vorher- und Nachher-Aufnahme erzeugt Abweichungen,
die mit der Website nichts zu tun haben. Als `FINDINGS` gemeldet, schickt das jemanden auf die Suche
nach einer Regression, die die Umgebung erfunden hat.

**5 ist nicht 2.** Eine Guard-Ablehnung als „Werkzeugfehler" zu melden, versteckt ein
Sicherheitsereignis in einer Betriebsstörung. Als „Befund" gemeldet, nennt es einen Angriff eine
Website-Regression.

### 10.2 Pinned-Origin-Allowlisting

Die geforderte Blockade privater IP-Bereiche hätte den einzigen unterstützten Anwendungsfall
zerstört. Die entwickelte Auflösung:

Jeder erlaubte Origin wird **einmal** aufgelöst, und seine Adressen werden eingefroren. Danach ist
eine private Adresse **genau dann** zulässig, wenn sie im eingefrorenen Satz liegt **und** ihr
Origin auf der Allowlist steht.

| Ziel | Ergebnis | Grund |
|---|---|---|
| `https://acme.ddev.site` → `127.0.0.1` | zulässig | gepinnt + erlaubt |
| `http://169.254.169.254/` | abgelehnt | Origin |
| `http://redis:6379/` | abgelehnt | Origin + Port |
| `https://evil.ddev.site` → `127.0.0.1` | abgelehnt | Origin |
| `acme.ddev.site` bindet später auf `169.254.169.254` um | abgelehnt | außerhalb des Pins |

Der eingefrorene Adresssatz löst zugleich das TOCTOU-Problem beim DNS-Rebinding. Verschleierte
Literale (`2130706433`, `0x7f000001`, `0177.0.0.1`) sowie IPv4-mapped-, NAT64- und
6to4-Einbettungen werden vor der Entscheidung entpackt.

Ein Detail mit unmittelbarer Praxisrelevanz: **Das Schema wird niemals umgeschrieben.** Genau diese
Umschreibung war die Ursache des Defekts aus Kapitel 5.3.

### 10.3 Prompt-Injection-Abwehr durch Architektur

Angesichts der Umgehungsraten aus Kapitel 3.3 wurde bewusst **nicht** versucht, dem Modell
Injektionserkennung beizubringen.

Stattdessen: Text aus Seitentiteln, Konsolenausgaben, Modul-Beschriftungen und Paketmetadaten wird
unter `untrusted*`-präfigierten Schlüsseln gespeichert, gekappt, escaped und stets in einem
Codeblock gerendert — und:

> **Kein verdiktproduzierender Codepfad darf ein Freitextfeld lesen.**

Der zugehörige Test mutiert den injizierten Text und prüft, dass das Verdikt **byteweise identisch**
bleibt. Das ist der Unterschied zwischen „funktioniert vermutlich nicht" und „kann strukturell nicht
wirken" — und es ist dieselbe Trennung von Vorschlag und Entscheidung, die CaMeL vorschlägt
[[7]](#lit7), nur auf der Ebene der Berichtsverarbeitung.

### 10.4 Credentials

`Authorization` und `Cookie` werden bei jedem Origin-Wechsel entfernt; der Origin wird vor Eingabe
der Zugangsdaten und erneut nach dem Login-POST geprüft. Implizites `.env`-Laden aus dem
Skill-Verzeichnis wurde entfernt — es teilte die Zugangsdaten eines Projekts mit jedem anderen
Projekt, das denselben Skill nutzte.

---

## 11. Dokumentation als Evidenzkette

### 11.1 Das Transkript ist nicht der Zustand

Die zentrale Regel:

> Ein Transkript hält fest, was beabsichtigt war. `state.json` hält fest, was geschehen ist.
> Widersprechen sie einander, gilt die Datei.

Das ist nicht nur Ordnungsliebe. Es ist die zweite unmittelbare Konsequenz aus dem
Self-Conditioning-Befund [[5]](#lit5): Ein Kontextfenster, das eigene Fehlversuche enthält, ist eine
schlechtere Wahrheitsquelle als eine Datei, die es nicht tut.

### 11.2 Ein Verzeichnis pro Schleife, sieben Dokumente pro Verzeichnis

Jedes Schleifenverzeichnis enthält **immer dieselben sieben** Markdown-Dokumente, jedes einem
Protokollschritt zugeordnet. Feste Namen bedeuten, dass ein Gate eine Datei liest, statt Prosa nach
einem Satz zu durchsuchen, der vielleicht gar nicht darin steht.

Zwei Mutabilitätsregeln tragen die Beweiskraft:

- **`03-iterations.md` und `05-evidence.md` sind append-only.** Eine umgeschriebene Historie wird
  dadurch im Git-Diff sichtbar. Evidenz, die man unbemerkt ändern kann, ist keine.
- **`00-charter.md` und `01-preconditions.md` frieren nach dem Schreiben ein.** Damit wird „die
  Schleife hat ihre eigenen Vorbedingungen gelockert, als sie feststeckte" erkennbar — und das ist
  genau die Richtung, in die ein unter Druck stehender Prozess driftet.

### 11.3 Berichte werden zusammengesetzt, nicht geschrieben

Jede Zahl im Abschlussbericht stammt aus `state.json` oder einem Schleifenbericht. Markdown-
Zusammenfassungen werden aus dem JSON generiert.

> Eine Zahl, die im KPI-Bericht steht und nirgends im Laufverzeichnis, ist eine Erfindung — so
> plausibel sie auch klingt.

Der Befund aus Kapitel 5.3 (fest kodierte Empfehlungen im Lighthouse-Bericht) ist der empirische
Beleg dafür, dass diese Regel notwendig ist: Ohne sie sind erfundene und gemessene Aussagen im
Enddokument nicht mehr unterscheidbar.

### 11.4 Abdeckung wird deklariert, nicht impliziert

Wo keine vollständige Pixelabdeckung erreicht wurde, verzeichnet das Manifest die **tatsächlichen
URL-Kennungen** samt Grund — niemals nur eine Zahl. Bei erschöpftem Budget sagt die Zusammenfassung
das **im ersten Absatz**.

---

## 12. Evaluation

### 12.1 Was messbar erreicht wurde

| Dimension | Vorher | Nachher |
|---|---|---|
| Aktionen mit aussagekräftigem Exit-Code | 1 von 6 | 6 von 6 |
| Sicherheitstests | 0 | 53, alle bestanden |
| SSRF-Ziele der Analyse abgewehrt | 0 von 7 | 7 von 7 |
| `SKILL.md` | 39 KB, 67 Zeilen > 200 Zeichen | 402 Zeilen, 0 Zeilen > 160 |
| Reproduzierbare Stichprobe | nein | ja, geseedeter Fisher-Yates |
| Persistenter Zustand | keiner | `state.json` + Journal + Schemata |
| Schleifenzähler / Abbruch | keine | 7 Abbruchbedingungen |
| Behavioural Evals | 0 | 12 |
| Trigger-Evals (Sammlung) | 0 | 173, davon 0 generiert |
| Skills mit Eval-Suite | 4 von 26 | 26 von 26 |
| Kollidierende Paare (≥ 0,13) | 3 | 1, beide Seiten vendiert |
| Agentenregeln (repoweit) | 0 | 3 |

### 12.2 Was die Evals prüfen

Die zwölf Evals adressieren gezielt Regeln, die unter Zeitdruck brechen: Sitemaps vor der Baseline
reparieren, re-baselinen um eine Regression zu verdecken, eine Schwelle anheben um den Selbsttest zu
bestehen, Vertrag-B-Arbeit innerhalb von Vertrag A, durch eine Oszillation iterieren statt
abzubrechen, eine Umgebungsdrift als Befund triagieren, injizierten Seitentext befolgen,
Zugangsdaten über einen Cross-Origin-Redirect senden, vollständige Abdeckung implizieren, deployen,
den PHP-8.5-Versuch überspringen, eine Extension ohne Messung entfernen.

Jede beschreibt ein Versagen, das einen Lauf **stillschweigend** entwertet.

### 12.3 Was die Trigger-Evals ergaben

Die Trigger-Evals wurden ausgeführt, und der Lauf war die härteste Kontrolle dieser Arbeit.

Ausgangslage waren 132 generierte Fälle mit einer Bestehensquote von 89 %. Eine Prüfung des
Bestands zeigte, dass **alle 132 entartet** waren: 88 wörtliche Teilzeichenketten der eigenen
`SKILL.md`, 22 unausgefüllte Platzhalter, 22 Kopien derselben Negativprobe. Die 89 % maßen
`prompt in description`.

Die 136 handgeschriebenen Ersatzfälle erreichten im ersten Lauf **50 % beziehungsweise
80 %** — deutlich unter den entarteten. Fast alle Fehlschläge lagen an den Beschreibungen,
nicht an den Fällen. Drei erreichten **exakt null** bei Fragen aus ihrem eigenen Kerngebiet:

| Skill | Frage mit Score 0,00 | Was der Beschreibung fehlte |
|---|---|---|
| `architecture-decision-records` | „Dokumentiere, **warum** wir Redis gewählt und was wir **verworfen** haben" | *warum*, *verworfen*, *Alternativen* |
| `typo3-powermail` | „ein **Feld**, das nur erscheint, wenn ein anderes gesetzt ist" | *Feld* |
| `typo3-seo` | „verhindern, dass die Staging-Seite **indexiert** wird" | *Index*, *Staging* |

Alle drei waren Merkmallisten in API-Vokabular — `datamaps`, `cmdmaps`, `f:mark.contentArea`
—, die die Maschinerie benennen und nie das Problem. Nach Überarbeitung von sechzehn
Beschreibungen: 100 % bei unterschriebenen wie bei vorgeschlagenen Fällen, ein deklarierter
`xfail`, und die kollidierenden Paare fielen von drei auf eines.

### 12.4 Was nicht evaluiert wurde

Die Trigger-Evals sind gegen einen **lexikalischen Stellvertreter** gemessen, nicht gegen ein
Modell. Er zeigt, ob eine Beschreibung das Vokabular trägt, das ein Nutzer tippt; er sagt
nichts darüber, wie ein Router tatsächlich entscheidet. Der Modell-Grader erfordert eine
gültige Anmeldung, die zum Zeitpunkt dieser Arbeit fehlte; `run_evals.py` endet in diesem
Fall mit Exit-Code 2 statt Quoten aus dem Nichts zu berichten. Die zwölf Behaviour-Evals
sind formuliert, aber nicht ausgeführt — sie brauchen denselben Grader. Die Sicherheitsmodule sind durch
Unit-Tests abgedeckt; die Schleifenmechanik ist es nicht. Der vollständige Harness v2 ist zum
Zeitpunkt dieser Arbeit teilweise implementiert: Sicherheitskern und Hilfsmodule sind fertig und
getestet, die Aufnahme- und Vergleichspfade laufen weiterhin über die v1-Skripte, deren kritische
Defekte einzeln behoben wurden.

Dieser Zustand ist in `references/visual-regression.md` ausdrücklich dokumentiert, einschließlich der
verbleibenden bekannten Defekte in v1 — damit niemand ein v1-Grün für einen Beweis hält.

---

## 13. Grenzen der Arbeit

**Kein Feldeinsatz.** Der wichtigste Vorbehalt. Kein vollständiger Migrationslauf gegen ein reales
Kundenprojekt wurde durchgeführt. Alle Aussagen über Praxistauglichkeit sind Architekturaussagen.

**Zeremonie-Kollaps ist unbewiesen.** Sieben Dokumente × etwa zwanzig Schleifen ergeben rund 140
Dateien. Die Gegenmaßnahmen — Scaffolding aus Vorlagen, Gates gegen `report.json` statt gegen Prosa,
Vorlagen als nahezu leere Tabellen — sind plausibel, aber nicht validiert. Es bleibt möglich, dass
ein Agent unter Druck die Dokumente entwertet, indem er sie formal ausfüllt.

**Der Selbsttest könnte zu streng sein.** Auf einer Website mit echten Live-Feeds oder nicht
mockbaren Drittanbieter-Einbettungen wird Loop 000 möglicherweise nie null erreichen. Die
Ausweichregel — `unstable_urls` mit ADR und Ausschluss aus dem Invarianzanspruch — ist entworfen,
aber nicht erprobt. Wird sie zu großzügig genutzt, höhlt sie den Anspruch aus.

**Lokale Messung bleibt lokal.** Vertrag B misst in DDEV. Die Vorbehalte sind dokumentiert, aber
Dokumentation verhindert nicht, dass eine Zahl aus ihrem Kontext gerissen weitergereicht wird.

**Einzelfallstudie.** Ein Skill, eine Domäne, ein Autor. Die Übertragbarkeitsaussagen in Kapitel 14
sind Hypothesen.

**Literaturlage.** Die zitierte Praxisliteratur ist überwiegend nicht peer-reviewed. Wo Aussagen aus
Blogbeiträgen und Herstellerdokumentation stammen, ist das kenntlich gemacht.

---

## 14. Übertragbarkeit

### 14.1 Was domänenunabhängig ist

Fünf Elemente scheinen unabhängig von TYPO3 und von CMS-Migrationen:

1. **Ein Prüfwerkzeug muss beweisen, dass es rot werden kann**, bevor sein Grün etwas bedeutet.
2. **Determinismus ist Vorbedingung, nicht Qualitätsmerkmal.** Ohne ihn misst man Varianz.
3. **Abbrechen schlägt Iterieren**, sobald Fehlversuche den Kontext kontaminieren [[5]](#lit5).
4. **Verdikte dürfen nicht an Freitext hängen**, wenn Freitext aus untrusted Quellen stammt.
5. **Zwei Ziele mit gegensätzlichen Erfolgskriterien gehören in getrennte, sequentielle Verträge.**

Das Zwei-Vertrags-Modell dürfte überall dort tragen, wo eine Migration und eine Verbesserung
gleichzeitig gewünscht sind — Framework-Upgrades, Datenbankmigrationen, Infrastrukturwechsel.

### 14.2 Die Auflösung der Architekturspannung

Die in Kapitel 3.1 beschriebene Spannung zwischen prozessbesitzenden und komponierbaren Skills löst
sich nicht durch Wahl, sondern durch **Trennung nach Verletzlichkeit**:

- **Zentral bleibt, was bei Auslagerung seine Wirkung verliert**: der Vertrag, die
  Phasenreihenfolge, die Sicherheitsgrenzen, das Completion Gate. Eine Regel, die man übersehen
  kann, weil sie hinter einem Link liegt, ist keine Regel.
- **Ausgelagert wird, was zum Zeitpunkt seiner Anwendung geladen werden kann**: Phasenprozeduren,
  Messrezepte, Feature-Migrationen.

Praktisch bedeutet das: `SKILL.md` schrumpfte von 39 KB auf 402 Zeilen und deckt dabei **mehr**
Umfang ab. Pococks Kritik trifft nicht den Prozessbesitz an sich, sondern den Prozessbesitz **ohne
Einsicht** — und ein Laufverzeichnis, in dem jeder Schritt sein eigenes Dokument hat, ist die
Gegenmaßnahme dazu.

### 14.3 Nachtrag: Skills ohne Evals sind unbelegte Behauptungen

Nach Abschluss der Hauptarbeit trat eine Quelle hinzu, die den zentralen Befund dieser
Arbeit auf die Ebene der Skills selbst hebt: Philipp Schmid (Google DeepMind), *Don't Ship
Skills Without Evals* [[14]](#lit14), zusammen mit seinen schriftlichen Fassungen desselben
Materials [[15]](#lit15)[[16]](#lit16).

Die Parallele ist exakt. Kapitel 5.2 zeigte ein **Werkzeug**, das nicht rot werden konnte.
Schmid beschreibt **Skills**, die nie geprüft wurden — abgenommen durch zwei manuelle Läufe
und die Zustimmung einer Kollegin. In beiden Fällen entsteht dieselbe Struktur: ein Artefakt,
das Erfolg meldet, ohne dass irgendetwas diesen Erfolg misst.

Vier Übernahmen und zwei Ergänzungen.

**Übernommen.** Erstens die Taxonomie: *capability* Skills schließen eine Modelllücke und
sind befristet; *preference* Skills kodieren Konventionen und sind dauerhaft. Die
Unterscheidung entscheidet, was ein fehlschlagender Eval bedeutet — Skill reparieren oder
Skill löschen. Zweitens der Befund, dass die meisten Fehler im **Trigger** liegen, nicht in
den Anweisungen: Die Beschreibung ist der einzige Text, den ein Agent für jeden Skill in
jedem Zug sieht. Drittens die Pflicht zu **Negativfällen**. Viertens die
Stilllegungsprüfung: Evals ohne den Skill ausführen; bestehen sie weiterhin, hat das Modell
ihn absorbiert.

**Ergänzung 1 — Entwürfe zählen nicht als Abdeckung.** Schmids Befund, dass
menschengeschriebene Skills generierte übertreffen, gilt auch für deren Evals. Ein Eval, der
eine Vorlage füllt, prüft die Vorlage. Jeder Fall trägt daher `status`, und nur `reviewed`
zählt.

Der Generator liefert das Argument überzeugender als die Regel. Aus der Beschreibung von
`typo3-update` leitete er die Trigger-Prompts `"TYPO3 v14"` und `"Upgrades"` ab — Text, der
auf nahezu jeden Skill der Sammlung passt und damit nichts unterscheidet. Diese Fälle sind
valides JSON, erfüllen eine Mindestanzahl und sind wertlos. Genau dafür existiert die
Trennung: `scripts/validate_evals.py` meldet **4 von 26** geprüften Suiten, nicht 26 von 26.

**Ergänzung 2 — Trigger-Kollision als Messgröße.** Die Quellen behandeln
Beschreibungsqualität je Skill. Sie behandeln nicht, was geschieht, wenn **37 Beschreibungen
in einer Sammlung konkurrieren** — ein anderes Problem: nicht „ist diese Beschreibung gut?",
sondern „ist sie von ihren Nachbarn unterscheidbar?".

`scripts/trigger_collisions.py` berechnet eine IDF-gewichtete Jaccard-Überlappung über die
distinktiven Terme jedes Beschreibungspaars. Drei reale Kollisionen:

| Überlappung | Paar | Geteilte Terme |
|---|---|---|
| 0,155 | `typo3-rector` ↔ `typo3-update` | viewfactory, tca, migrations, events |
| 0,145 | `typo3-conformance` ↔ `typo3-extension-upgrade` | hashservice, ext_tables.php, v14.3 |
| 0,139 | `typo3-batch` ↔ `typo3-update` | upgrades, tca, migrations, fluid |

Jede aufgelöste Grenze ist ein Ein-Satz-Diskriminator, festgehalten durch handgeschriebene
Negativfälle: **Automatisierung** trennt Rector von der API-Referenz, **Skalierung** trennt
Batch von ihr.

**Der Befund, den das Werkzeug nicht finden konnte — und der der wichtigste war.** Der
Analysator liest **Beschreibungen**. Er liest keine **Namen**. Die schwerwiegendste Kollision
der Sammlung war eine Namenskollision.

`typo3-update` und `typo3-14-update` lagen *unter* der Schwelle, weil ihre
Beschreibungsvokabulare tatsächlich auseinandergehen. Sie waren dennoch das Paar, das
Nutzer am häufigsten verwechselten — aus einem Grund, den kein lexikalisches Maß sehen kann:
`typo3-update` war der kürzere, naheliegendere Name, den ein Mensch wie ein Agent greift,
wenn er TYPO3 aktualisieren will — und er bezeichnete lediglich die API-Referenz. Der Skill,
der tatsächlich aktualisierte, trug den längeren, versionsgebundenen Namen.

Ein Name ist ebenfalls ein Trigger. Die Umbenennung behob es:

| | vorher | nachher |
|---|---|---|
| API-Referenz | `typo3-update` | `typo3-v14-reference` |
| Update-Orchestrator | `typo3-14-update` | `typo3-upgrade-run` |

Das Ergebnis war messbar, und das ist der übertragbare Teil: Umbenennung plus Neufassung
beider Beschreibungen führte die Sammlung von **drei kollidierenden Paaren auf zwei**.
`typo3-batch ↔ typo3-update` verschwand vollständig, das Rector-Paar fiel von 0,155 auf
0,137. Übrig bleibt ein Paar zwischen zwei vendorierten Skills, die wir nicht bearbeiten.

`typo3-upgrade-run` ist damit auch nicht mehr versionsgebunden benannt — was ohnehin falsch
war: Der kodierte Vertrag (erst Invarianz, dann Elevation) ist nicht v14-spezifisch. Nur
sein Ziel ist es.

Zwei Grenzen bleiben. Die Schwelle 0,13 ist eine Konvention, keine Messung. Und der
Analysator sieht weiterhin weder Namen noch konzeptuelle Überschneidung.

**Wo wir bewusst abweichen.** Die Quellen empfehlen kleine, komponierbare Skills und warnen
vor Überspezifikation. `typo3-upgrade-run` ist erklärtermaßen ein Prozess-Orchestrator mit
fester Phasenreihenfolge, weil die Reihenfolge **die** Sicherheitseigenschaft ist. Der
Widerspruch löst sich über die Regel „Ergebnisse einschränken, Prozeduren in Skripte":
Vertrag, Verbote und Gates stehen im Skill, die exakte Befehlsfolge in `scripts/t3u.mjs`.
Der präskriptive Teil wurde zum Programm — worauf der Rat tatsächlich zielt.

Der Kernsatz aus Kapitel 15.2 überträgt sich unverändert von Werkzeugen auf Skills: Was
nicht scheitern kann, misst nichts.

### 14.4 Ein Beitrag zur Skill-Architektur: die Regelebene

Die untersuchte Skill-Sammlung besitzt neben Skills eine **Regelebene**: atomare, immer aktive
Constraints, über `appliesTo`-Globs zugeordnet.

Für agentenbezogene Sicherheitsanforderungen ist das die richtige Form. Die Alternative — dieselbe
Vertrauenshierarchie in 22 Skill-Dokumente zu kopieren — erzeugt 22 Stellen, die auseinanderdriften
können, und verlässt sich darauf, dass der passende Skill geladen wurde.

Die drei formulierten Regeln (untrusted content ist Daten; Credentials nur an einen Origin; kein
Ergebnis ohne Evidenz) gelten für **jede** Aufgabe, nicht für einen Dateityp.

---

## 15. Fazit und weitere Arbeit

### 15.1 Beantwortung der Forschungsfragen

**F1.** Der Nachweis gelingt, weil er das Orakel umgeht: Invarianz ist eine **metamorphe
Relation** zwischen zwei Läufen und braucht kein Wissen darüber, wie die korrekte Ausgabe
aussieht (Kapitel 6.2). Darauf setzen vier Bedingungen auf — eine vor jeder Änderung
versiegelte Baseline; ein Messwerkzeug, das gegen sich selbst null beweist; eine eingefrorene,
per Fingerabdruck geprüfte Umgebung; deklarierte statt implizierter Abdeckung. Fehlt eine, ist
das Ergebnis eine Behauptung. Belegt wird damit Invarianz, nicht Korrektheit.

**F2.** Durch sequentielle Verträge mit getrennten Baselines und getrennten Genehmigungen. Der
Konflikt ist ein Modellierungsfehler, kein Abwägungsproblem.

**F3.** Eine Ursache pro Iteration, strikte Fortschrittsanforderung, sieben Abbruchbedingungen,
Idempotenz-Nachlauf. Abbrechen ist der korrekte Ausgang, sobald weitere Iterationen den Kontext
verschlechtern statt ihn zu klären.

**F4.** Durch Architektur statt Erkennung: Pinned-Origin-Allowlisting löst den SSRF/DDEV-Konflikt,
und die Regel „kein verdiktproduzierender Pfad liest Freitext" macht Injektionen wirkungslos, statt
sie zu erkennen zu versuchen.

**F5.** Maschinenlesbarer Zustand plus append-only-Journal, gelesen von der Platte, nicht aus dem
Kontext.

### 15.2 Der zentrale Beitrag

Wenn diese Arbeit einen Satz hinterlässt, dann diesen:

> **Ein Prüfwerkzeug, das nicht beweisen kann, dass es rot werden kann, und nicht beweisen kann,
> dass es das betrachtet hat, was es zu betrachten behauptet, darf kein Verdikt abgeben.**

Der Skill hatte hervorragendes TYPO3-Fachwissen, eine korrekte Prozessarchitektur und ein
vollständiges Completion Gate. Er konnte trotzdem vierzig kaputte Seiten als Erfolg melden — weil
zwischen einem korrekten Ergebnis und einem beobachtbaren Resultat ein Verbindungsstück fehlte.

Fachwissen war nie das Problem. Beobachtbarkeit war es.

### 15.3 Weitere Arbeit

**Feldvalidierung.** Der offensichtlichste nächste Schritt: drei bis fünf reale Migrationen mit
Erfassung von Selbsttest-Konvergenz, Iterationszahlen je Schleife, Abbruchhäufigkeit und
tatsächlicher Dokumentnutzung.

**Zeremonie-Kosten messen.** Wie viel Zeit entfällt auf Dokumentation gegenüber Reparatur? Ab welcher
Schleifenzahl kippt der Nutzen?

**Cluster-Signaturen validieren.** Die These, dass ein normalisiertes DOM-Skelett ohne Text ein
tragfähiger Template-Proxy ist, ist plausibel und ungeprüft. Falsche Cluster-Bildung erzeugt genau
die Blindstelle, die die gestufte Abdeckung vermeiden soll.

**Behaviour-Evals ausführen.** Die zwölf Fälle sind formuliert, aber nicht gemessen; sie
brauchen denselben Modell-Grader, den inzwischen auch die Trigger-Evals fordern.

**Regelebene evaluieren.** Werden `appliesTo`-gematchte Regeln von Agenten tatsächlich befolgt, oder
brauchen sie Verstärkung im Skill-Dokument?

**Trigger-Evals gegen ein Modell messen.** Der Schritt von „Suite vorhanden" zu „Suite grün"
ist getan — 173 Fälle, keiner generiert, 100 % unter dem lexikalischen Stellvertreter. Offen
ist der Schritt von „grün beim Stellvertreter" zu „grün beim Router". Erst er belegt, dass
die Beschreibungen ein Modell tatsächlich richtig leiten; bis dahin ist jede Zahl eine
Aussage über Vokabular, nicht über Verhalten.

**Kollisionsschwelle empirisch bestimmen.** 0,13 ist weiterhin gesetzt, nicht gemessen —
anders als die Treffer-Untergrenze von 6,0, die aus dem schwächsten echten Treffer (6,18)
abgeleitet wurde. Dieselbe Methode ließe sich auf die Kollisionsschwelle anwenden, sobald
genügend protokollierte Fehlaktivierungen vorliegen.

**Konzeptuelle Kollision erfassen.** Der lexikalische Ansatz übersah das Paar, das später zu
`typo3-v14-reference` und `typo3-upgrade-run` umbenannt wurde: Die Beschreibungen
divergierten, die *Namen* nicht. Er übersieht ebenso Homonyme — `typo3-batch` feuert auf
„Refactor this React component to use hooks", weil TYPO3-Hooks und React-Hooks dasselbe
Token sind; der Fall ist als `known_limitation` festgehalten. Ein Embedding-basiertes Maß
könnte beides schließen, ist aber teurer und schwerer zu erklären — die Abwägung ist offen.

---

## 16. Literaturverzeichnis

<a id="lit1"></a>**[1]** Anthropic Engineering: *Agent Skills*. Progressive Disclosure als zentrales
Entwurfsprinzip; dreistufiges Ladeverfahren (Discovery, Activation, Execution).
Zusammengefasst in: agentskills.io, *Agent Skills Overview*. https://agentskills.io/home

<a id="lit2"></a>**[2]** SwirlAI Newsletter: *Agent Skills: Progressive Disclosure as a System Design
Pattern*. https://www.newsletter.swirlai.com/p/agent-skills-progressive-disclosure

<a id="lit3"></a>**[3]** Pocock, M.: *skills — Skills for Real Engineers*. GitHub.
https://github.com/mattpocock/skills — Kritik an prozessbesitzenden Frameworks; Prinzip kleiner,
anpassbarer, komponierbarer Skills.

<a id="lit4"></a>**[4]** *Beyond pass@1: A Reliability Science Framework for Long-Horizon LLM
Agents*. arXiv:2603.29231. https://arxiv.org/pdf/2603.29231

<a id="lit5"></a>**[5]** *The Long-Horizon Task Mirage? Diagnosing Where and Why Agentic Systems
Break*. arXiv:2604.11978. https://arxiv.org/html/2604.11978v1 — Fehlerkomposition über abhängige
Schritte; Self-Conditioning durch eigene Fehler im Kontextfenster.

<a id="lit6"></a>**[6]** Willison, S.: *The lethal trifecta for AI agents: private data, untrusted
content, and external communication*. 16. Juni 2025.
https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/

<a id="lit7"></a>**[7]** *A Critical Evaluation of Defenses against Prompt Injection Attacks*.
arXiv:2505.18333. https://arxiv.org/pdf/2505.18333 — 100 % Umgehungsrate durch menschliche
Red-Teamer gegen zwölf Abwehrmechanismen; CaMeL als architektonische Trennung von Vorschlag und
Ausführung.

<a id="lit8"></a>**[8]** Shakacode: *Flaky Visual Regression Tests, and what to do about them*.
https://www.shakacode.com/blog/flaky-visual-regression-tests-and-what-to-do-about-them/

<a id="lit9"></a>**[9]** Desplega.ai: *Visual Regression Testing: Advanced Troubleshooting and
Production Hardening*.
https://www.desplega.ai/blog/deep-dive-3-visual-regression-testing-production-hardening

<a id="lit10"></a>**[10]** *An Empirical Study of Flaky Tests in JavaScript*. arXiv:2207.01047.
https://arxiv.org/pdf/2207.01047

<a id="lit11"></a>**[11]** corewebvitals.io: *AI Agent Core Web Vitals: Why Field Data Changes
Everything*. https://www.corewebvitals.io/pagespeed/ai-core-web-vitals-debugging — INP als reine
Feldmetrik; TBT als unvollkommene Näherung; Web Almanac 2025: 52 % der mobilen Websites verfehlen im
Feld mindestens einen Core Web Vital.

<a id="lit18"></a>**[18]** Chen, T. Y. et al.: *Metamorphic Testing: A Review of Challenges
and Opportunities*. ACM Computing Surveys. — Metamorphes Testen als Antwort auf das
Orakelproblem: Relationen zwischen Ausführungen statt Kenntnis der korrekten Ausgabe. Die
Invarianzforderung dieser Arbeit ist ein Anwendungsfall.

<a id="lit14"></a>**[14]** Schmid, P.: *Don't Ship Skills Without Evals*. Google DeepMind.
Vortrag. https://www.youtube.com/watch?v=0vphxNt4wyk — Skills als ungetestete Artefakte;
Taxonomie capability/preference; Trigger als primäre Fehlerquelle; Stilllegungsprüfung.

<a id="lit15"></a>**[15]** Schmid, P.: *8 Tips for Writing Agent Skills*.
https://www.philschmid.de/agent-skills-tips

<a id="lit16"></a>**[16]** Schmid, P.: *Practical Guide to Evaluating and Testing Agent
Skills*. https://www.philschmid.de/testing-skills — Erfolgskriterien, Eval-Harness,
10–20 Prompts aus realer Nutzung, 3–5 Durchläufe je Fall.

<a id="lit17"></a>**[17]** Gechev, M.: *Unit Tests for AI Agent Skills*.
https://blog.mgechev.com/2026/02/26/skill-eval/ — deterministische Grader gegen
LLM-Rubrik-Grader; `pass@k` gegen `pass^k`.

<a id="lit12"></a>**[12]** *Tiefenanalyse und Verbesserungsvorschläge für den Skill
typo3-14-update*. Interne statische Analyse, 24. Juli 2026. Primärquelle dieser Arbeit.

<a id="lit13"></a>**[13]** TYPO3 Feature #108345: *Extension metadata in composer.json*. TYPO3 Core
Changelog 14.0.

**Hinweis zur Quellenlage.** [1], [2], [3], [8], [9] und [11] sind Praxisliteratur ohne
Peer-Review. [4], [5], [7] und [10] sind arXiv-Preprints. Die zentralen Argumente dieser Arbeit
stützen sich auf am Quelltext verifizierte Befunde; die Literatur liefert Einordnung und
theoretische Motivation, nicht die Beweislast.

---

## 17. Anhang

### A. Befundkatalog

| # | Befund | Quelle | Schwere |
|---|---|---|---|
| 1 | Drei Aktionen ohne aussagekräftigen Exit-Code | Codeverifikation | kritisch |
| 2 | Sitemap-SSRF ohne jede Begrenzung | Analyse + verifiziert | kritisch |
| 3 | Credentials folgen Redirects ohne Origin-Prüfung | Analyse + verifiziert | kritisch |
| 4 | `--disable-web-security` im Standardpfad | Analyse + verifiziert | kritisch |
| 5 | `.env` aus dem Skill-Verzeichnis | Analyse + verifiziert | hoch |
| 6 | Schema-Hartkodierung auf `https://` | Codeverifikation | hoch |
| 7 | Vergleich nur über Vorher-Verzeichnis | Codeverifikation | hoch |
| 8 | Dokumentierter, nicht existenter Standardwert | Codeverifikation | hoch |
| 9 | Unseeded, verzerrte Stichprobe | Analyse + verifiziert | hoch |
| 10 | Keine Prompt-Injection-Grenze | Analyse | hoch |
| 11 | Prozentuale Toleranz als bestandenes Ergebnis | Analyse | hoch |
| 12 | Backend-Module übersprungen, Lauf grün | Analyse + verifiziert | hoch |
| 13 | Selektor-Interpolation ohne Escaping | Analyse + verifiziert | mittel |
| 14 | Keine Redaktion in Berichten | Analyse | mittel |
| 15 | Zufälliges Link-Klicken im Smoke-Test | Analyse + verifiziert | mittel |
| 16 | Fest kodierte Empfehlungen als Messergebnisse | Codeverifikation | mittel |
| 17 | Kein committetes Lockfile | Codeverifikation | mittel |
| 18 | README widersprach dem Skill („production rollout") | Codeverifikation | mittel |
| 19 | Kompatibilitätsmatrix behauptete PHP 8.2/8.3 für einen Skill mit 8.4-Gate | Codeverifikation | mittel |
| 20 | `typo3-update` lehrte `^14.0`, PHP 8.2, `ext_emconf.php` | Codeverifikation | mittel |

Befunde 1, 6, 7, 8, 16–20 wurden von der externen statischen Analyse nicht erfasst.

### B. Die sieben Befundklassen

| Klasse | Behoben in | Blockiert Vertrag A? |
|---|---|---|
| `regression` | der Website | **ja** |
| `declared-change` | nirgends — dokumentiert | nur ohne Genehmigung |
| `pre-existing` | außerhalb des Umfangs von A | nein |
| `harness-noise` | dem Werkzeug, via Loop 000 | **ja** |
| `environment` | der Übergabe | nein |
| `content-drift` | eskalieren — Vergleich ungültig | **ja** |
| `improvement` | als Vertrag-B-Kandidat notiert | nein |

### C. Phasen und Schleifen

| Phase | Schleifen | Vertrag |
|---|---|---|
| P00–P01 Aufnahme, Umgebung einfrieren | — | — |
| P02 Determinismus-Selbsttest | 000 | harness |
| P03 Baseline A versiegeln | 001 | harness |
| P04 Vorbereitende Stabilisierung | 010–040 | A |
| P05–P09 Ziel, Leiter, Migration, Ausführung | 100–140 | A |
| P10 Feature-Parität | 200–230 | A |
| P11 Invarianz-Abschluss | 300 | A |
| P12 Backend, Betrieb, Qualität | 310–320 | A |
| P13 Abschlusszertifikat | — | A |
| P14 Elevation | 500–560 | B |
| P15 Bericht und Übergabe | 900 | report |

---

*Code MIT · Inhalt CC-BY-SA-4.0*
