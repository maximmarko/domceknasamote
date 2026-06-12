# Rezervacny workflow

Tento projekt je teraz pripraveny na online odoslanie rezervacie cez API endpoint namiesto `mailto:`.

## Co je uz hotove

- Formular v [obsadenost.html](/c:/Users/Legion/Desktop/nigger/obsadenost.html) posiela data na `window.BOOKING_CONFIG.endpoint`.
- Frontend v [script.js](/c:/Users/Legion/Desktop/nigger/script.js) uz odosiela JSON rezervacie a zobrazuje stav odoslania.
- V [google-apps-script/booking-workflow.gs](/c:/Users/Legion/Desktop/nigger/google-apps-script/booking-workflow.gs) je pripraveny backend pre Google Apps Script:
  - prijme rezervaciu
  - posle email majitelovi
  - v emaile ponukne `Potvrdit rezervaciu` a `Zamietnut rezervaciu`
  - po rozhodnuti posle email hostovi
  - po potvrdeni zobrazi odkaz `Pridat udalost do Google Kalendara`

## Ako to zapojit

1. V Google Apps Script vytvor novy projekt.
2. Vloz obsah suboru `google-apps-script/booking-workflow.gs`.
3. V `Project Settings > Script properties` nastav:
   - `OWNER_EMAIL` = email majitela
   - `CALENDAR_ID` = ID Google Kalendara, ktory chces pouzit pre synchronizaciu
   - `WEB_APP_URL` = URL nasadenej web appky
4. Nasad skript cez `Deploy > New deployment > Web app`.
5. Nastav pristup minimalne tak, aby linky z emailu vedeli otvorit majitelia.
6. Skopiruj URL web appky a vloz ju do `window.BOOKING_CONFIG.endpoint` v [obsadenost.html](/c:/Users/Legion/Desktop/nigger/obsadenost.html).
7. Do `window.BOOKING_CONFIG.ownerEmail` vloz mail majitela.
8. Do `window.BOOKING_CONFIG.approvalCalendarId` vloz rovnake `CALENDAR_ID`, ake pouzivas na webe pre obsadenost.

## Potvrdzovacie linky (riesenie /u/N/ problemu)

Tlacidla v emailoch (Potvrdit / Zamietnut / Odoslat mail klientovi) nesmeruju priamo
na `script.google.com`, ale na verejnu stranku [potvrdit.html](/c:/Users/Legion/Desktop/nigger/potvrdit.html)
na webe. Tato stranka zavola Apps Script cez `fetch` v rezime `no-cors`, cize bez Google
cookies = anonymne. Tym sa obide presmerovanie na `/u/N/` ucet, ktore pri viacerych
prihlasenych Google uctoch hadze chybu "subor sa nepodarilo otvorit".

Dolezite:
- V `potvrdit.html` je `EXEC_URL` = exec URL nasadenej web appky. Meni sa len vtedy, ak
  spravis `New deployment` (nie `Manage deployments > Edit`).
- V `booking-workflow.gs` je `PUBLIC_ACTION_URL` = adresa tejto stranky na webe.
- Deployment musi mat `Who has access = Anyone` (anonymny pristup), inak fetch neprejde.

## Dolezita poznamka

Synchronizacia na stranke funguje len vtedy, ked po potvrdeni pridas udalost do toho isteho Google Kalendara, z ktoreho [script.js](/c:/Users/Legion/Desktop/nigger/script.js) cita obsadenost.
