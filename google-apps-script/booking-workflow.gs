const SCRIPT_TZ = Session.getScriptTimeZone() || "Europe/Bratislava";
const SHEET_NAME = "Reservations";
// Verejna stranka na webe, ktora akciu vykona cez fetch bez Google cookies.
// Tym sa obide presmerovanie na /u/N/ ucet pri viacerych prihlasenych uctoch.
const PUBLIC_ACTION_URL = "https://domceknasamote.sk/potvrdit.html";
const COLUMN_INDEX = {
  id: 1,
  createdAt: 2,
  status: 3,
  ownerEmail: 4,
  guestFirstName: 5,
  guestLastName: 6,
  guestEmail: 7,
  guestPhone: 8,
  startDate: 9,
  endDate: 10,
  nights: 11,
  guests: 12,
  paymentMethod: 13,
  totalPrice: 14,
  originalPrice: 15,
  discountRate: 16,
  street: 17,
  city: 18,
  zip: 19,
  country: 20,
  notes: 21,
  marketingConsent: 22,
  requiredConsent: 23,
  approveToken: 24,
  rejectToken: 25,
  decisionAt: 26,
  calendarId: 27,
  calendarLink: 28,
  birthDate: 29,
  identityDocument: 30
};

function doPost(e) {
  try {
    const payload = parseJsonBody_(e);
    validateReservationPayload_(payload);

    const record = createReservationRecord_(payload);
    appendReservation_(record);
    sendOwnerApprovalEmail_(record);
    sendGuestReceiptEmail_(record);

    return jsonResponse_({
      success: true,
      message: "Rezervačná žiadosť bola odoslaná. Na email vám príde potvrdenie o prijatí."
    });
  } catch (error) {
    return jsonResponse_({
      success: false,
      message: error && error.message ? error.message : "Rezerváciu sa nepodarilo spracovať."
    });
  }
}

function doGet(e) {
  const action = String((e.parameter && e.parameter.action) || "").toLowerCase();
  const token = String((e.parameter && e.parameter.token) || "").trim();

  if (!action || !token) {
    return htmlResponse_("Neplatný odkaz", "<p>V odkaze chýba akcia alebo token rezervácie.</p>");
  }

  if (["approve", "reject", "send-confirmation"].indexOf(action) === -1) {
    return htmlResponse_("Neznáma akcia", "<p>Podporované akcie sú approve, reject a send-confirmation.</p>");
  }

  const reservation = findReservationByToken_(action, token);
  if (!reservation) {
    return htmlResponse_("Rezervácia sa nenašla", "<p>Tento odkaz je neplatný alebo už nie je dostupný.</p>");
  }

  if (action === "send-confirmation") {
    return sendGuestPaymentEmailFlow_(reservation);
  }

  if (reservation.status !== "pending") {
    return htmlResponse_(
      "Rezervácia už bola spracovaná",
      `<p>Rezervácia <strong>${escapeHtml_(reservation.id)}</strong> už má stav <strong>${escapeHtml_(reservation.status)}</strong>.</p>`
    );
  }

  if (action === "approve") {
    return approveReservationFlow_(reservation);
  }

  if (action === "reject") {
    return rejectReservationFlow_(reservation);
  }

  return htmlResponse_("Neznáma akcia", "<p>Podporované akcie sú approve a reject.</p>");
}

function authorizeServices() {
  GmailApp.getAliases();
  const calendarId = getConfigValue_("CALENDAR_ID", "");
  const calendar = calendarId ? CalendarApp.getCalendarById(calendarId) : CalendarApp.getDefaultCalendar();
  if (!calendar) {
    throw new Error("CALENDAR_ID nie je dostupný pre tento účet. Zdieľajte kalendár s účtom Apps Scriptu alebo opravte CALENDAR_ID.");
  }
  PropertiesService.getScriptProperties().getProperties();
  return "OK";
}

function approveReservationFlow_(reservation) {
  const calendarEvent = createGoogleCalendarEvent_(reservation);
  updateReservationDecision_(reservation.rowNumber, "approved_pending_guest_email", calendarEvent.getId());
  sendOwnerGuestPaymentReviewEmail_(reservation);
  const archived = archiveOwnerApprovalThread_(reservation);

  const content = [
    `<p>Rezervácia <strong>${escapeHtml_(reservation.id)}</strong> bola potvrdená.</p>`,
    `<p>Udalosť <strong>${escapeHtml_(calendarEvent.getTitle())}</strong> bola vložená do Google Kalendára.</p>`,
    "<p>Majiteľ dostal kontrolný email s pripraveným textom pre klienta.</p>",
    "<p>Klientovi sa finálny email odošle až po kliknutí na tlačidlo Odoslať mail klientovi v kontrolnom emaile.</p>",
    `<p>Potvrdzovací email bol ${archived ? "archivovaný v schránke" : "ponechaný v schránke, pretože sa ho nepodarilo automaticky nájsť v Inboxe"}.</p>`
  ].join("");

  return htmlResponse_("Rezervácia potvrdená", content);
}

function rejectReservationFlow_(reservation) {
  updateReservationDecision_(reservation.rowNumber, "rejected", "");
  sendGuestDecisionEmail_(reservation, "rejected");
  const archived = archiveOwnerApprovalThread_(reservation);

  return htmlResponse_(
    "Rezervácia zamietnutá",
    `<p>Rezervácia <strong>${escapeHtml_(reservation.id)}</strong> bola zamietnutá a hosť dostal informačný email.</p><p>Potvrdzovací email bol ${archived ? "archivovaný v schránke" : "ponechaný v schránke, pretože sa ho nepodarilo automaticky nájsť v Inboxe"}.</p>`
  );
}

function parseJsonBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error("Chýba telo požiadavky.");
  }

  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    throw new Error("Požiadavka nemá validný JSON formát.");
  }
}

function validateReservationPayload_(payload) {
  if (!payload) {
    throw new Error("Chýbajú dáta rezervácie.");
  }

  const requiredFields = [
    "startDate",
    "endDate",
    "guestEmail",
    "guestPhone",
    "birthDate",
    "identityDocument",
    "guestCount",
    "paymentMethod"
  ];

  requiredFields.forEach(function (field) {
    if (!String(payload[field] || "").trim()) {
      throw new Error("Chýbajú povinné údaje rezervácie.");
    }
  });

  if (!payload.consents || payload.consents.required !== true) {
    throw new Error("Bez povinného súhlasu nie je možné rezerváciu odoslať.");
  }

  if (!isValidBirthDate_(payload.birthDate)) {
    throw new Error("Dátum narodenia musí byť platný a vo formáte DD.MM.YYYY.");
  }
}

function isValidBirthDate_(value) {
  const match = String(value || "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) {
    return false;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date <= new Date()
  );
}

function createReservationRecord_(payload) {
  const ownerEmail = getConfigValue_("OWNER_EMAIL", payload.ownerEmail || "");
  const calendarId = getConfigValue_("CALENDAR_ID", payload.calendarId || "");
  const scriptUrl = normalizeWebAppUrl_(getConfigValue_("WEB_APP_URL", ScriptApp.getService().getUrl() || ""));

  if (!ownerEmail) {
    throw new Error("V Apps Script Properties chýba OWNER_EMAIL.");
  }

  if (!scriptUrl) {
    throw new Error("V Apps Script Properties chýba WEB_APP_URL.");
  }

  const createdAt = new Date();
  const reservationId = Utilities.getUuid().slice(0, 8).toUpperCase();
  const approveToken = Utilities.getUuid();
  const rejectToken = Utilities.getUuid();

  return {
    id: reservationId,
    createdAt: createdAt,
    createdAtLabel: Utilities.formatDate(createdAt, SCRIPT_TZ, "dd.MM.yyyy HH:mm"),
    status: "pending",
    ownerEmail: ownerEmail,
    guestFirstName: String(payload.guestFirstName || "").trim(),
    guestLastName: String(payload.guestLastName || "").trim(),
    guestEmail: String(payload.guestEmail || "").trim(),
    guestPhone: String(payload.guestPhone || "").trim(),
    birthDate: String(payload.birthDate || "").trim(),
    identityDocument: String(payload.identityDocument || "").trim(),
    startDate: String(payload.startDate || "").trim(),
    endDate: String(payload.endDate || "").trim(),
    startDateLabel: String(payload.startDateLabel || payload.startDate || "").trim(),
    endDateLabel: String(payload.endDateLabel || payload.endDate || "").trim(),
    nights: Number(payload.nights || 0),
    guestCount: String(payload.guestCount || "").trim(),
    paymentMethod: String(payload.paymentMethod || "").trim(),
    totalPrice: Number(payload.totalPrice || 0),
    totalPriceLabel: String(payload.totalPriceLabel || "").trim(),
    originalPrice: Number(payload.originalPrice || 0),
    originalPriceLabel: String(payload.originalPriceLabel || "").trim(),
    discountRate: Number(payload.discountRate || 0),
    street: String(payload.street || "").trim(),
    city: String(payload.city || "").trim(),
    zip: String(payload.zip || "").trim(),
    country: String(payload.country || "").trim(),
    notes: String(payload.notes || "").trim(),
    marketingConsent: Boolean(payload.consents && payload.consents.marketing),
    requiredConsent: Boolean(payload.consents && payload.consents.required),
    approveToken: approveToken,
    rejectToken: rejectToken,
    approveUrl: buildPublicActionUrl_("approve", approveToken),
    rejectUrl: buildPublicActionUrl_("reject", rejectToken),
    calendarId: calendarId,
    calendarLink: ""
  };
}

function appendReservation_(record) {
  const sheet = getReservationSheet_();
  sheet.appendRow([
    record.id,
    record.createdAt,
    record.status,
    record.ownerEmail,
    record.guestFirstName,
    record.guestLastName,
    record.guestEmail,
    record.guestPhone,
    record.startDate,
    record.endDate,
    record.nights,
    record.guestCount,
    record.paymentMethod,
    record.totalPrice,
    record.originalPrice,
    record.discountRate,
    record.street,
    record.city,
    record.zip,
    record.country,
    record.notes,
    record.marketingConsent,
    record.requiredConsent,
    record.approveToken,
    record.rejectToken,
    "",
    record.calendarId,
    "",
    record.birthDate,
    record.identityDocument
  ]);
}

function sendOwnerApprovalEmail_(record) {
  const body = [
    "Prišla nová žiadosť o rezerváciu.",
    "",
    `ID rezervácie: ${record.id}`,
    `Vytvorené: ${record.createdAtLabel}`,
    `Termín: ${record.startDateLabel} - ${record.endDateLabel}`,
    `Počet nocí: ${record.nights}`,
    `Počet osôb: ${record.guestCount}`,
    `Platba: ${record.paymentMethod}`,
    `Pôvodná cena: ${record.originalPriceLabel}`,
    `Finálna cena: ${record.totalPriceLabel}`,
    `Zľava: ${Math.round(record.discountRate * 100)}%`,
    "",
    `Meno: ${record.guestFirstName} ${record.guestLastName}`.trim(),
    `Email: ${record.guestEmail}`,
    `Telefón: ${record.guestPhone}`,
    `Dátum narodenia: ${record.birthDate}`,
    `Číslo občianskeho preukazu / pasu: ${record.identityDocument}`,
    `Adresa: ${[record.street, record.city, record.zip, record.country].filter(Boolean).join(", ") || "-"}`,
    `Poznámka: ${record.notes || "-"}`,
    `Marketingový súhlas: ${record.marketingConsent ? "Áno" : "Nie"}`,
    "",
    `Potvrdiť rezerváciu: ${record.approveUrl}`,
    `Zamietnuť rezerváciu: ${record.rejectUrl}`
  ].join("\n");

  const htmlBody = [
    "<p>Prišla nová žiadosť o rezerváciu.</p>",
    "<table style=\"border-collapse:collapse\">",
    tableRow_("ID rezervácie", record.id),
    tableRow_("Vytvorené", record.createdAtLabel),
    tableRow_("Termín", `${record.startDateLabel} - ${record.endDateLabel}`),
    tableRow_("Počet nocí", String(record.nights)),
    tableRow_("Počet osôb", record.guestCount),
    tableRow_("Platba", record.paymentMethod),
    tableRow_("Pôvodná cena", record.originalPriceLabel),
    tableRow_("Finálna cena", record.totalPriceLabel),
    tableRow_("Zľava", `${Math.round(record.discountRate * 100)}%`),
    tableRow_("Meno", `${record.guestFirstName} ${record.guestLastName}`.trim() || "-"),
    tableRow_("Email", record.guestEmail),
    tableRow_("Telefón", record.guestPhone),
    tableRow_("Dátum narodenia", record.birthDate),
    tableRow_("Číslo občianskeho preukazu / pasu", record.identityDocument),
    tableRow_("Adresa", [record.street, record.city, record.zip, record.country].filter(Boolean).join(", ") || "-"),
    tableRow_("Poznámka", record.notes || "-"),
    tableRow_("Marketingový súhlas", record.marketingConsent ? "Áno" : "Nie"),
    "</table>",
    `<p><a href="${record.approveUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#2f6d4f;color:#ffffff;text-decoration:none;font-weight:700;margin-right:10px">Potvrdiť rezerváciu</a>`,
    `<a href="${record.rejectUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#9a3c3c;color:#ffffff;text-decoration:none;font-weight:700">Zamietnuť rezerváciu</a></p>`
  ].join("");

  GmailApp.sendEmail(record.ownerEmail, `Nová rezervácia ${record.id}`, body, {
    htmlBody: htmlBody,
    replyTo: record.guestEmail,
    name: "Domček na Samote - Rezervácie"
  });
}

function sendGuestReceiptEmail_(record) {
  const body = [
    "Dobrý deň,",
    "",
    "vaša rezervačná žiadosť bola prijatá a čaká na schválenie majiteľom.",
    "",
    `ID rezervácie: ${record.id}`,
    `Termín: ${record.startDateLabel} - ${record.endDateLabel}`,
    `Počet osôb: ${record.guestCount}`,
    `Platba: ${record.paymentMethod}`,
    `Cena: ${record.totalPriceLabel}`,
    "",
    "Po spracovaní vám príde ďalší email s výsledkom rezervácie."
  ].join("\n");

  GmailApp.sendEmail(record.guestEmail, `Prijali sme vašu rezerváciu ${record.id}`, body, {
    name: "Domček na Samote"
  });
}

function sendGuestDecisionEmail_(reservation, decision) {
  const approved = decision === "approved";
  const subject = approved
    ? `Rezervácia ${reservation.id} bola potvrdená`
    : `Rezervácia ${reservation.id} nebola potvrdená`;
  const body = approved
    ? [
        "Dobrý deň,",
        "",
        "vaša rezervácia bola potvrdená.",
        "",
        `ID rezervácie: ${reservation.id}`,
        `Termín: ${reservation.startDateLabel} - ${reservation.endDateLabel}`,
        `Cena: ${reservation.totalPriceLabel}`,
        "",
        "Ďakujeme za váš záujem. Ďalšie pokyny k úhrade vám pošleme samostatne."
      ].join("\n")
    : [
        "Dobrý deň,",
        "",
        "mrzí nás to, ale vaša rezervácia nebola potvrdená.",
        "",
        `ID rezervácie: ${reservation.id}`,
        `Termín: ${reservation.startDateLabel} - ${reservation.endDateLabel}`,
        "",
        "V prípade záujmu nás prosím kontaktujte a skúsime nájsť iný voľný termín."
      ].join("\n");

  GmailApp.sendEmail(reservation.guestEmail, subject, body, {
    name: "Domček na Samote"
  });
}

function sendOwnerGuestPaymentReviewEmail_(reservation) {
  const sendUrl = createActionUrl_("send-confirmation", reservation.approveToken);
  const guestSubject = buildGuestPaymentEmailSubject_(reservation);
  const guestBody = buildGuestPaymentEmailBody_(reservation);
  const body = [
    `Rezervácia ${reservation.id} bola potvrdená a vložená do kalendára.`,
    "",
    "Nižšie je pripravený email pre klienta na kontrolu.",
    "Ak je text v poriadku, kliknite na odkaz Odoslať mail klientovi.",
    "",
    `Komu: ${reservation.guestEmail}`,
    `Predmet: ${guestSubject}`,
    "",
    guestBody,
    "",
    `Odoslať mail klientovi: ${sendUrl}`
  ].join("\n");

  const htmlBody = [
    `<p>Rezervácia <strong>${escapeHtml_(reservation.id)}</strong> bola potvrdená a vložená do kalendára.</p>`,
    "<p>Nižšie je pripravený email pre klienta na kontrolu. Ak je text v poriadku, kliknite na tlačidlo.</p>",
    "<table style=\"border-collapse:collapse;margin-bottom:18px\">",
    tableRow_("Komu", reservation.guestEmail),
    tableRow_("Predmet", guestSubject),
    "</table>",
    `<div style="border:1px solid #dedede;border-radius:12px;padding:18px;margin:18px 0;background:#fafafa;white-space:normal">${nl2br_(guestBody)}</div>`,
    `<p><a href="${sendUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#2f6d4f;color:#ffffff;text-decoration:none;font-weight:700">Odoslať mail klientovi</a></p>`
  ].join("");

  GmailApp.sendEmail(reservation.ownerEmail, `Kontrola emailu klientovi ${reservation.id}`, body, {
    htmlBody: htmlBody,
    replyTo: reservation.guestEmail,
    name: "Domček na Samote - Rezervácie"
  });
}

function sendGuestPaymentEmailFlow_(reservation) {
  if (reservation.status === "approved") {
    return htmlResponse_(
      "Email už bol odoslaný",
      `<p>Email klientovi pre rezerváciu <strong>${escapeHtml_(reservation.id)}</strong> už bol odoslaný.</p>`
    );
  }

  if (reservation.status !== "approved_pending_guest_email") {
    return htmlResponse_(
      "Email nie je pripravený",
      `<p>Rezervácia <strong>${escapeHtml_(reservation.id)}</strong> má stav <strong>${escapeHtml_(reservation.status)}</strong>, preto sa email klientovi nedá odoslať.</p>`
    );
  }

  const subject = buildGuestPaymentEmailSubject_(reservation);
  const body = buildGuestPaymentEmailBody_(reservation);
  GmailApp.sendEmail(reservation.guestEmail, subject, body, {
    name: "Domček na Samote"
  });
  updateReservationStatus_(reservation.rowNumber, "approved");

  return htmlResponse_(
    "Email bol odoslaný",
    `<p>Email klientovi <strong>${escapeHtml_(reservation.guestEmail)}</strong> bol odoslaný.</p>`
  );
}

function buildGuestPaymentEmailSubject_(reservation) {
  return `Rezervácia ubytovania ${reservation.startDateLabel} - ${reservation.endDateLabel}`;
}

function buildGuestPaymentEmailBody_(reservation) {
  const totalPriceLabel = reservation.totalPriceLabel || formatCurrency_(reservation.totalPrice);
  const depositLabel = formatCurrency_(Number(reservation.totalPrice || 0) * 0.3);

  return [
    "Dobrý deň,",
    "",
    `ďakujeme za rezerváciu ubytovania v Domčeku na samote v termíne ${reservation.startDateLabel} - ${reservation.endDateLabel}`,
    "",
    `Aby sme Vám mohli termín záväzne potvrdiť, prosíme o úhradu zálohy vo výške ${depositLabel}`,
    `(30 % z celkovej ceny ${totalPriceLabel}).`,
    "",
    "Platbu môžete uhradiť na účet:",
    "",
    "Chaty pod tatrami, s. r. o.",
    "",
    "IBAN: SK89 0900 0000 0052 1364 8006",
    "",
    "SWIFT: GIBASKBX",
    "",
    "Po pripísaní platby Vám zašleme potvrdenie.",
    "",
    "O termíne doplatku Vás budeme včas informovať e-mailom.",
    "Pri nástupe na pobyt Vám vystavíme faktúru s možnosťou uplatnenia rekreačného poukazu.",
    "",
    "Tešíme sa na Vašu návštevu.",
    "Martin Marko RSc.",
    "Chaty pod Tatrami, s. r. o. – prevádzkovateľ ubytovania",
    "www.domceknasamote.sk",
    "https://www.orsr.sk/vypis.asp?ID=68414&SID=3&P=0&lan=sk"
  ].join("\n");
}

function updateReservationDecision_(rowNumber, status, calendarLink) {
  const sheet = getReservationSheet_();
  sheet.getRange(rowNumber, COLUMN_INDEX.status).setValue(status);
  sheet.getRange(rowNumber, COLUMN_INDEX.decisionAt).setValue(new Date());
  sheet.getRange(rowNumber, COLUMN_INDEX.calendarLink).setValue(calendarLink || "");
}

function updateReservationStatus_(rowNumber, status) {
  const sheet = getReservationSheet_();
  sheet.getRange(rowNumber, COLUMN_INDEX.status).setValue(status);
}

function findReservationByToken_(action, token) {
  const sheet = getReservationSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, COLUMN_INDEX.identityDocument).getValues();
  const tokenIndex = action === "reject" ? COLUMN_INDEX.rejectToken - 1 : COLUMN_INDEX.approveToken - 1;

  for (let i = 0; i < values.length; i += 1) {
    const row = values[i];
    if (String(row[tokenIndex]) !== token) {
      continue;
    }

    return mapReservationRow_(row, i + 2);
  }

  return null;
}

function mapReservationRow_(row, rowNumber) {
  return {
    rowNumber: rowNumber,
    id: String(row[COLUMN_INDEX.id - 1]),
    createdAt: row[COLUMN_INDEX.createdAt - 1],
    createdAtLabel: row[COLUMN_INDEX.createdAt - 1]
      ? Utilities.formatDate(new Date(row[COLUMN_INDEX.createdAt - 1]), SCRIPT_TZ, "dd.MM.yyyy HH:mm")
      : "",
    status: String(row[COLUMN_INDEX.status - 1]),
    ownerEmail: String(row[COLUMN_INDEX.ownerEmail - 1]),
    guestFirstName: String(row[COLUMN_INDEX.guestFirstName - 1]),
    guestLastName: String(row[COLUMN_INDEX.guestLastName - 1]),
    guestEmail: String(row[COLUMN_INDEX.guestEmail - 1]),
    guestPhone: String(row[COLUMN_INDEX.guestPhone - 1]),
    birthDate: String(row[COLUMN_INDEX.birthDate - 1]),
    identityDocument: String(row[COLUMN_INDEX.identityDocument - 1]),
    startDate: String(row[COLUMN_INDEX.startDate - 1]),
    endDate: String(row[COLUMN_INDEX.endDate - 1]),
    startDateLabel: formatDateLabelFromIso_(row[COLUMN_INDEX.startDate - 1]),
    endDateLabel: formatDateLabelFromIso_(row[COLUMN_INDEX.endDate - 1]),
    nights: Number(row[COLUMN_INDEX.nights - 1] || 0),
    guestCount: String(row[COLUMN_INDEX.guests - 1]),
    paymentMethod: String(row[COLUMN_INDEX.paymentMethod - 1]),
    totalPrice: Number(row[COLUMN_INDEX.totalPrice - 1] || 0),
    totalPriceLabel: formatCurrency_(row[COLUMN_INDEX.totalPrice - 1]),
    originalPrice: Number(row[COLUMN_INDEX.originalPrice - 1] || 0),
    originalPriceLabel: formatCurrency_(row[COLUMN_INDEX.originalPrice - 1]),
    discountRate: Number(row[COLUMN_INDEX.discountRate - 1] || 0),
    street: String(row[COLUMN_INDEX.street - 1]),
    city: String(row[COLUMN_INDEX.city - 1]),
    zip: String(row[COLUMN_INDEX.zip - 1]),
    country: String(row[COLUMN_INDEX.country - 1]),
    notes: String(row[COLUMN_INDEX.notes - 1]),
    marketingConsent: String(row[COLUMN_INDEX.marketingConsent - 1]) === "true" || row[COLUMN_INDEX.marketingConsent - 1] === true,
    requiredConsent: String(row[COLUMN_INDEX.requiredConsent - 1]) === "true" || row[COLUMN_INDEX.requiredConsent - 1] === true,
    approveToken: String(row[COLUMN_INDEX.approveToken - 1]),
    rejectToken: String(row[COLUMN_INDEX.rejectToken - 1]),
    calendarId: String(row[COLUMN_INDEX.calendarId - 1] || "")
  };
}

function createGoogleCalendarEvent_(reservation) {
  const calendar = reservation.calendarId
    ? CalendarApp.getCalendarById(reservation.calendarId)
    : CalendarApp.getDefaultCalendar();

  if (!calendar) {
    throw new Error("Nepodarilo sa nájsť Google Kalendár pre potvrdenú rezerváciu.");
  }

  const startDate = parseDateForCalendar_(reservation.startDate);
  const endDate = parseDateForCalendar_(addDaysToDateValue_(reservation.endDate, 1));

  if (!startDate || !endDate) {
    throw new Error("Termín rezervácie sa nepodarilo vložiť do Google Kalendára.");
  }

  const title = "Rezervácia - Domček na Samote";
  const address = buildReservationAddress_(reservation);

  return calendar.createAllDayEvent(title, startDate, endDate, {
    description: buildReservationCalendarDescription_(reservation, address),
    location: "Domček na Samote"
  });
}

function buildReservationCalendarDescription_(reservation, address) {
  return [
    `ID rezervácie: ${reservation.id}`,
    `Vytvorené: ${reservation.createdAtLabel || "-"}`,
    `Hosť: ${[reservation.guestFirstName, reservation.guestLastName].filter(Boolean).join(" ") || "-"}`,
    `Email: ${reservation.guestEmail || "-"}`,
    `Telefón: ${reservation.guestPhone || "-"}`,
    `Dátum narodenia: ${formatBirthDateForCalendar_(reservation.birthDate)}`,
    `Číslo občianskeho preukazu / pasu: ${reservation.identityDocument || "-"}`,
    `Adresa: ${address || "-"}`,
    `Počet osôb: ${reservation.guestCount || "-"}`,
    `Počet nocí: ${reservation.nights || "-"}`,
    `Platba: ${reservation.paymentMethod || "-"}`,
    `Pôvodná cena: ${reservation.originalPriceLabel || "-"}`,
    `Finálna cena: ${reservation.totalPriceLabel || "-"}`,
    `Zľava: ${Math.round(Number(reservation.discountRate || 0) * 100)}%`,
    `Termín pobytu: ${reservation.startDateLabel} - ${reservation.endDateLabel}`,
    `Povinný súhlas: ${reservation.requiredConsent ? "Áno" : "Nie"}`,
    `Marketingový súhlas: ${reservation.marketingConsent ? "Áno" : "Nie"}`,
    "Poznámka pre kalendár: deň odchodu je zablokovaný celý kvôli čisteniu a príprave vírivky.",
    `Poznámka od hosťa: ${reservation.notes || "-"}`
  ].join("\n");
}

function buildReservationAddress_(reservation) {
  return [
    reservation.street,
    reservation.city,
    reservation.zip,
    reservation.country
  ].filter(Boolean).join(", ");
}

function formatBirthDateForCalendar_(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/);

  return match ? `${match[1]}/${match[2]}/${match[3]}` : text || "-";
}

function archiveOwnerApprovalThread_(reservation) {
  try {
    const query = `in:inbox subject:"Nová rezervácia ${reservation.id}"`;
    const threads = GmailApp.search(query, 0, 10);
    if (!threads.length) {
      return false;
    }

    GmailApp.moveThreadsToArchive(threads);
    return true;
  } catch (error) {
    return false;
  }
}

function getReservationSheet_() {
  const spreadsheetId = getOrCreateSpreadsheetId_();
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  const requiredColumnCount = COLUMN_INDEX.identityDocument;
  if (sheet.getMaxColumns() < requiredColumnCount) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      requiredColumnCount - sheet.getMaxColumns()
    );
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "reservation_id",
      "created_at",
      "status",
      "owner_email",
      "guest_first_name",
      "guest_last_name",
      "guest_email",
      "guest_phone",
      "start_date",
      "end_date",
      "nights",
      "guest_count",
      "payment_method",
      "total_price",
      "original_price",
      "discount_rate",
      "street",
      "city",
      "zip",
      "country",
      "notes",
      "marketing_consent",
      "required_consent",
      "approve_token",
      "reject_token",
      "decision_at",
      "calendar_id",
      "calendar_link",
      "birth_date",
      "identity_document"
    ]);
  } else {
    const extraHeaders = sheet
      .getRange(1, COLUMN_INDEX.birthDate, 1, 2)
      .getValues()[0];
    if (extraHeaders[0] !== "birth_date") {
      sheet.getRange(1, COLUMN_INDEX.birthDate).setValue("birth_date");
    }
    if (extraHeaders[1] !== "identity_document") {
      sheet.getRange(1, COLUMN_INDEX.identityDocument).setValue("identity_document");
    }
  }

  return sheet;
}

function getOrCreateSpreadsheetId_() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheetId = props.getProperty("SPREADSHEET_ID");
  if (spreadsheetId) {
    return spreadsheetId;
  }

  const spreadsheet = SpreadsheetApp.create("Chalupka rezervacie");
  props.setProperty("SPREADSHEET_ID", spreadsheet.getId());
  return spreadsheet.getId();
}

function getConfigValue_(key, fallback) {
  const props = PropertiesService.getScriptProperties();
  return String(props.getProperty(key) || fallback || "").trim();
}

function createActionUrl_(action, token) {
  return buildPublicActionUrl_(action, token);
}

function buildPublicActionUrl_(action, token) {
  return `${PUBLIC_ACTION_URL}?action=${encodeURIComponent(action)}&token=${encodeURIComponent(token)}`;
}

function normalizeWebAppUrl_(url) {
  return String(url || "").trim().replace(/\/macros\/u\/\d+\/s\//, "/macros/s/");
}

function tableRow_(label, value) {
  return `<tr><td style="padding:6px 12px 6px 0;font-weight:700;vertical-align:top">${escapeHtml_(label)}</td><td style="padding:6px 0">${escapeHtml_(value || "-")}</td></tr>`;
}

function formatCurrency_(value) {
  const number = Number(value || 0);
  return `${Math.round(number)} €`;
}

function formatDateLabelFromIso_(value) {
  if (!value) {
    return "";
  }

  if (Object.prototype.toString.call(value) === "[object Date]" && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, SCRIPT_TZ, "dd.MM.yyyy");
  }

  const text = String(value).trim();
  const parsedDate = new Date(text);
  if (!Number.isNaN(parsedDate.getTime())) {
    return Utilities.formatDate(parsedDate, SCRIPT_TZ, "dd.MM.yyyy");
  }

  const parts = text.split("-");
  if (parts.length !== 3) {
    return text;
  }

  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function parseDateForCalendar_(value) {
  if (!value) {
    return null;
  }

  if (Object.prototype.toString.call(value) === "[object Date]" && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const text = String(value).trim();
  const parts = text.split("-");
  if (parts.length === 3) {
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  const parsedDate = new Date(text);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
}

function addDaysToDateValue_(value, daysToAdd) {
  if (!value) {
    return value;
  }

  const date = Object.prototype.toString.call(value) === "[object Date]"
    ? new Date(value.getTime())
    : new Date(String(value).trim());

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  date.setDate(date.getDate() + Number(daysToAdd || 0));
  return date;
}

function escapeHtml_(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nl2br_(value) {
  return escapeHtml_(value).replace(/\n/g, "<br>");
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function htmlResponse_(title, body) {
  const html = `<!DOCTYPE html>
<html lang="sk">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml_(title)}</title>
    <style>
      body{margin:0;font-family:Arial,sans-serif;background:#f6f1e8;color:#233126}
      .wrap{max-width:760px;margin:0 auto;padding:48px 24px}
      .card{background:#fffdf8;border:1px solid #dfd2bf;border-radius:24px;padding:32px;box-shadow:0 20px 40px rgba(35,49,38,.08)}
      h1{margin:0 0 16px;font-size:32px}
      p{line-height:1.6}
      a{color:#2f6d4f;font-weight:700}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>${escapeHtml_(title)}</h1>
        ${body}
      </div>
    </div>
  </body>
</html>`;

  return HtmlService.createHtmlOutput(html).setTitle(title);
}
