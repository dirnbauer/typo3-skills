---
name: "legal-impressum"
description: "Creates and reviews Austrian Impressum and disclosure content for websites, including ECG, UGB, GewO, MedienG, Offenlegung, and company-form-specific templates. Use when the user mentions Impressum, legal notice, imprint, Austria, Oesterreich, Mediengesetz, Offenlegung, or website operator disclosure."
metadata:
  skill_type: capability
  version: "1.0.0"
  origin: "webconsulting"
license: "MIT / CC-BY-SA-4.0"
---
# Austrian Impressum Requirements

> Source: https://github.com/dirnbauer/webconsulting-skills

> **Jurisdiction:** Austria (Österreich)
> 
> **Related Skills:**
> - [SKILL-GERMANY.md](./SKILL-GERMANY.md) - German requirements
> - [SKILL-EU.md](./SKILL-EU.md) - EU-wide requirements
> - [SKILL-WORLD.md](./SKILL-WORLD.md) - International requirements

This skill provides comprehensive guidance on Austrian Impressum (legal notice) requirements for websites and electronic media, covering all company types (Gesellschaftsformen).

---

## 1. Legal Framework Overview

| Law | German Name | Scope | Penalty |
|-----|-------------|-------|---------|
| § 5 ECG | E-Commerce-Gesetz | All commercial websites | Up to €3,000 |
| § 14 UGB | Unternehmensgesetzbuch | Firmenbuch-registered companies | Varies |
| § 63 GewO | Gewerbeordnung | Non-Firmenbuch trade businesses | Varies |
| § 24 MedienG | Mediengesetz (Impressum) | Media works | Up to €20,000 |
| § 25 MedienG | Mediengesetz (Offenlegung) | Periodical media / public websites | Up to €20,000 |
| Art. 13-14 DSGVO | Datenschutz-Grundverordnung | Privacy notice | Up to €20M or 4% |
| § 4 DLG | Dienstleistungsgesetz | Service providers | Varies |
| ODR-VO (repealed) | Online Dispute Resolution | Platform discontinued 2025-07-20 (VO (EU) 2024/3228) | Remove legacy ODR links — keeping them is an Abmahnung risk |

---

## 2. Quick Reference by Gesellschaftsform

| Company Type | Firmenbuch | Required Fields | Special Notes |
|--------------|------------|-----------------|---------------|
| Einzelunternehmen (not registered) | No | Name, address, trade, chamber | § 63 GewO applies |
| Einzelunternehmen e.U. | Yes | Firm name, FB-Nr, court, address | § 14 UGB applies |
| OG (Offene Gesellschaft) | Yes | Firm, FB-Nr, court, all partners | Partners' names required |
| KG (Kommanditgesellschaft) | Yes | Firm, FB-Nr, court, Komplementäre | Kommanditisten optional |
| GmbH | Yes | Firm, FB-Nr, court, seat; check other applicable disclosures | Capital disclosure is conditional under § 14(2) UGB, not universally mandatory |
| FlexCo (FlexKapG) | Yes | Firm, FB-Nr, court, seat; check other applicable disclosures | Distinguish formation capital rules from website disclosure duties |
| GmbH & Co KG | Yes | Both entities' details | Dual disclosure |
| AG (Aktiengesellschaft) | Yes | Firm, FB-Nr, court, seat; check other applicable disclosures | Apply § 14(2) UGB if capital is stated |
| SE (Europäische Gesellschaft) | Yes | Firm, FB-Nr, court, seat; check other applicable disclosures | Check the applicable SE and Austrian provisions for this entity |
| GesBR | No | All partners' names, addresses | Civil law partnership |
| Genossenschaft | Yes | Firm, FB-Nr, court, Vorstand | Cooperative |
| Verein | ZVR | Name, ZVR-Zahl, address, Vorstand | Association register |

---

## 3. Required Fields by Law

### 3.1 E-Commerce-Gesetz (§ 5 ECG)

Applies to **all commercial websites**:

| Field | Description | Required |
|-------|-------------|----------|
| Name/Firma | Full legal name or company name | ✓ |
| Geographic address | Physical address (no P.O. Box) | ✓ |
| Email | Contact email address | ✓ |
| Phone | Contact phone (if available) | Optional but recommended |
| Firmenbuch number | FN XXXXXX + court (if applicable) | ✓ if registered |
| Aufsichtsbehörde | Supervisory authority (if regulated) | ✓ if applicable |
| Kammer/Berufsverband | Chamber membership (trade businesses) | ✓ if applicable |
| Berufsrecht | Professional regulations, access link | ✓ if regulated profession |
| UID-Nummer | VAT ID (if VAT registered) | ✓ if applicable |
| Unternehmensgegenstand | Business purpose — required by § 25 Abs 5 MedienG (Offenlegung), not § 5 ECG | ✓ per MedienG |

### 3.2 Unternehmensgesetzbuch (§ 14 UGB)

Additional requirements for **Firmenbuch-registered companies** on all business letters, including websites:

| Field | Description |
|-------|-------------|
| Firma | Exact registered company name |
| Rechtsform | Legal form (GmbH, AG, OG, KG, etc.) |
| Sitz | Registered seat (city) |
| Firmenbuchnummer | FN number with registration court |
| Firmenbuchgericht | Court where registered (e.g., "LG Wien") |
| Kapital | If voluntarily stated, disclose the relevant capital and any outstanding contributions required by § 14(2) UGB |
| Liquidation | "in Liquidation" if applicable |

Verify [§ 14 UGB in RIS](https://ris.bka.gv.at/eli/drgbl/1897/219/P14/NOR40263725)
against the actual entity. Paragraph 2 is conditional: mentioning capital triggers its
completeness requirements; the formation minimum is not itself a mandatory website field.
The templates below omit optional capital statements. Do not invent paid-in amounts, and
have uncertain entity-specific duties reviewed by a qualified Austrian legal professional.

### 3.3 Gewerbeordnung (§ 63 GewO)

For **trade businesses NOT in Firmenbuch**:

| Field | Description |
|-------|-------------|
| Name | Full name of owner |
| Standort | Business location |
| Gewerbe | Trade/business type |
| Behörde | Issuing authority (Bezirkshauptmannschaft) |
| Kammer | WKO membership (Bundesland) |

---

## 4. All Gesellschaftsformen - Detailed Templates

### 4.1 Einzelunternehmen (Not Firmenbuch-registered)

```
IMPRESSUM

Max Mustermann
Musterstraße 1
1010 Wien
Österreich

Tel.: +43 1 234 5678
E-Mail: office@mustermann.at

Gewerbe: Handel mit Waren aller Art
Gewerbebehörde: Magistrat der Stadt Wien

Mitglied der WKO Wien
Berufsrecht: Gewerbeordnung 1994 (www.ris.bka.gv.at)

UID-Nr.: ATU12345678
```

### 4.2 Einzelunternehmen e.U. (Firmenbuch-registered)

```
IMPRESSUM

Max Mustermann e.U.
Musterstraße 1
1010 Wien
Österreich

Tel.: +43 1 234 5678
E-Mail: office@mustermann.at

Firmenbuchnummer: FN 123456a
Firmenbuchgericht: Handelsgericht Wien
Sitz: Wien

Unternehmensgegenstand: Handel mit Waren aller Art

Mitglied der WKO Wien
Berufsrecht: Gewerbeordnung 1994 (www.ris.bka.gv.at)

UID-Nr.: ATU12345678
```

### 4.3 Offene Gesellschaft (OG)

```
IMPRESSUM

Mustermann & Partner OG
Musterstraße 1
1010 Wien
Österreich

Tel.: +43 1 234 5678
E-Mail: office@mustermann-partner.at

Firmenbuchnummer: FN 123456g
Firmenbuchgericht: Handelsgericht Wien
Sitz: Wien

Gesellschafter:
- Max Mustermann
- Maria Musterfrau

Unternehmensgegenstand: Unternehmensberatung

Mitglied der WKO Wien
UID-Nr.: ATU12345678
```

### 4.4 Kommanditgesellschaft (KG)

```
IMPRESSUM

Mustermann KG
Musterstraße 1
1010 Wien
Österreich

Tel.: +43 1 234 5678
E-Mail: office@mustermann-kg.at

Firmenbuchnummer: FN 123456k
Firmenbuchgericht: Handelsgericht Wien
Sitz: Wien

Komplementär(e):
- Max Mustermann (unbeschränkt haftend)

Unternehmensgegenstand: Handel mit Waren aller Art

Mitglied der WKO Wien
UID-Nr.: ATU12345678
```

### 4.5 GmbH (Gesellschaft mit beschränkter Haftung)

```
IMPRESSUM

Muster GmbH
Musterstraße 1
1010 Wien
Österreich

Tel.: +43 1 234 5678
E-Mail: office@muster-gmbh.at

Firmenbuchnummer: FN 123456z
Firmenbuchgericht: Handelsgericht Wien
Sitz: Wien

Geschäftsführer: Max Mustermann

Unternehmensgegenstand: IT-Dienstleistungen

Mitglied der WKO Wien
UID-Nr.: ATU12345678
```

### 4.6 GmbH & Co KG

```
IMPRESSUM

Muster GmbH & Co KG
Musterstraße 1
1010 Wien
Österreich

Tel.: +43 1 234 5678
E-Mail: office@muster-kg.at

Firmenbuchnummer: FN 123456d
Firmenbuchgericht: Handelsgericht Wien
Sitz: Wien

Komplementärin: Muster Verwaltungs GmbH
  Firmenbuchnummer: FN 654321z
  Firmenbuchgericht: Handelsgericht Wien
  Geschäftsführer: Max Mustermann

Unternehmensgegenstand: Handel und Dienstleistungen

Mitglied der WKO Wien
UID-Nr.: ATU12345678
```

### 4.7 Aktiengesellschaft (AG)

```
IMPRESSUM

Muster AG
Musterstraße 1
1010 Wien
Österreich

Tel.: +43 1 234 5678
E-Mail: office@muster-ag.at

Firmenbuchnummer: FN 123456m
Firmenbuchgericht: Handelsgericht Wien
Sitz: Wien

Vorstand: Mag. Max Mustermann (Vorsitzender)
Aufsichtsratsvorsitzender: Dr. Klaus Beispiel

Unternehmensgegenstand: Holding und Beteiligungen

Mitglied der WKO Wien
UID-Nr.: ATU12345678
```

### 4.8 Europäische Gesellschaft (SE)

```
IMPRESSUM

Muster SE
Musterstraße 1
1010 Wien
Österreich

Tel.: +43 1 234 5678
E-Mail: office@muster-se.eu

Firmenbuchnummer: FN 123456s
Firmenbuchgericht: Handelsgericht Wien
Sitz: Wien

Vorstand: Max Mustermann (CEO)

Unternehmensgegenstand: Europäische Handelsgesellschaft

UID-Nr.: ATU12345678
```

### 4.9 Gesellschaft bürgerlichen Rechts (GesBR)

```
IMPRESSUM

Mustermann & Partner GesBR
Musterstraße 1
1010 Wien
Österreich

Tel.: +43 1 234 5678
E-Mail: office@mustermann-partner.at

Gesellschafter:
- Max Mustermann, Musterstraße 1, 1010 Wien
- Maria Musterfrau, Beispielgasse 2, 1020 Wien

Unternehmensgegenstand: Beratungsdienstleistungen

UID-Nr.: ATU12345678
```

### 4.10 Genossenschaft (eGen/SCE)

```
IMPRESSUM

Muster Genossenschaft eGen
Musterstraße 1
1010 Wien
Österreich

Tel.: +43 1 234 5678
E-Mail: office@muster-gen.at

Firmenbuchnummer: FN 123456v
Firmenbuchgericht: Handelsgericht Wien
Sitz: Wien

Vorstand:
- Max Mustermann (Obmann)
- Maria Musterfrau (Obmann-Stellvertreterin)

Unternehmensgegenstand: Förderung der Mitglieder

Mitglied des ÖGV
UID-Nr.: ATU12345678
```

### 4.11 Verein

```
IMPRESSUM

Musterverein
Musterstraße 1
1010 Wien
Österreich

Tel.: +43 1 234 5678
E-Mail: office@musterverein.at

ZVR-Zahl: 123456789

Vorstand:
- Max Mustermann (Obmann)
- Maria Musterfrau (Schriftführerin)
- Klaus Beispiel (Kassier)

Vereinszweck: Förderung von Kunst und Kultur
```

---


## Detailed Reference

Read [the full guide](references/full-guide.md) when the task needs detailed examples, long templates, troubleshooting matrices, appendices, or sections not included above. Keep this file unloaded for narrow tasks so the skill follows progressive disclosure.
