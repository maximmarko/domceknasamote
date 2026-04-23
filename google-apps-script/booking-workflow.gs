const SCRIPT_TZ = Session.getScriptTimeZone() || "Europe/Bratislava";
const SHEET_NAME = "Reservations";
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
  calendarLink: 28
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

  const reservation = findReservationByToken_(action, token);
  if (!reservation) {
    return htmlResponse_("Rezervácia sa nenašla", "<p>Tento odkaz je neplatný alebo už nie je dostupný.</p>");
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

function approveReservationFlow_(reservation) {
  const calendarLink = createGoogleCalendarTemplateUrl_(reservation);
  updateReservationDecision_(reservation.rowNumber, "approved", calendarLink);
  sendGuestDecisionEmail_(reservation, "approved");

  const content = [
    `<p>Rezervácia <strong>${escapeHtml_(reservation.id)}</strong> bola potvrdená.</p>`,
    "<p>Hosť dostal potvrdzujúci email.</p>",
    `<p><a href="${calendarLink}" target="_blank" rel="noopener noreferrer">Pridať udalosť do Google Kalendára</a></p>`,
    "<p>Ak použijete ten istý Google Kalendár ako na webe, obsadenosť sa po pridaní udalosti zosynchronizuje aj na stránke.</p>"
  ].join("");

  return htmlResponse_("Rezervácia potvrdená", content);
}

function rejectReservationFlow_(reservation) {
  updateReservationDecision_(reservation.rowNumber, "rejected", "");
  sendGuestDecisionEmail_(reservation, "rejected");

  return htmlResponse_(
    "Rezervácia zamietnutá",
    `<p>Rezervácia <strong>${escapeHtml_(reservation.id)}</strong> bola zamietnutá a hosť dostal informačný email.</p>`
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
}

function createReservationRecord_(payload) {
  const ownerEmail = getConfigValue_("OWNER_EMAIL", payload.ownerEmail || "");
  const calendarId = getConfigValue_("CALENDAR_ID", payload.calendarId || "");
  const scriptUrl = getConfigValue_("WEB_APP_URL", ScriptApp.getService().getUrl() || "");

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
    approveUrl: `${scriptUrl}?action=approve&token=${encodeURIComponent(approveToken)}`,
    rejectUrl: `${scriptUrl}?action=reject&token=${encodeURIComponent(rejectToken)}`,
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
    ""
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
    name: "Chalupka na Samote - rezervácie"
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
    name: "Chalupka na Samote"
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
    name: "Chalupka na Samote"
  });
}

function updateReservationDecision_(rowNumber, status, calendarLink) {
  const sheet = getReservationSheet_();
  sheet.getRange(rowNumber, COLUMN_INDEX.status).setValue(status);
  sheet.getRange(rowNumber, COLUMN_INDEX.decisionAt).setValue(new Date());
  sheet.getRange(rowNumber, COLUMN_INDEX.calendarLink).setValue(calendarLink || "");
}

function findReservationByToken_(action, token) {
  const sheet = getReservationSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 28).getValues();
  const tokenIndex = action === "approve" ? COLUMN_INDEX.approveToken - 1 : COLUMN_INDEX.rejectToken - 1;

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
    status: String(row[COLUMN_INDEX.status - 1]),
    ownerEmail: String(row[COLUMN_INDEX.ownerEmail - 1]),
    guestFirstName: String(row[COLUMN_INDEX.guestFirstName - 1]),
    guestLastName: String(row[COLUMN_INDEX.guestLastName - 1]),
    guestEmail: String(row[COLUMN_INDEX.guestEmail - 1]),
    guestPhone: String(row[COLUMN_INDEX.guestPhone - 1]),
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

function createGoogleCalendarTemplateUrl_(reservation) {
  const title = "Rezervácia - Chalupka na Samote";
  const details = [
    `ID rezervácie: ${reservation.id}`,
    `Hosť: ${[reservation.guestFirstName, reservation.guestLastName].filter(Boolean).join(" ") || "-"}`,
    `Email: ${reservation.guestEmail}`,
    `Telefón: ${reservation.guestPhone}`,
    `Počet osôb: ${reservation.guestCount}`,
    `Platba: ${reservation.paymentMethod}`,
    `Cena: ${reservation.totalPriceLabel}`,
    `Termín pobytu: ${reservation.startDateLabel} - ${reservation.endDateLabel}`,
    "Poznámka pre kalendár: deň odchodu je zablokovaný celý kvôli čisteniu a príprave vírivky.",
    `Poznámka od hosťa: ${reservation.notes || "-"}`
  ].join("\n");
  const start = formatDateForCalendarParam_(reservation.startDate);
  const end = formatDateForCalendarParam_(addDaysToDateValue_(reservation.endDate, 1));
  const params = [
    "action=TEMPLATE",
    `text=${encodeURIComponent(title)}`,
    `dates=${encodeURIComponent(`${start}/${end}`)}`,
    `details=${encodeURIComponent(details)}`,
    `location=${encodeURIComponent("Chalupka na Samote")}`
  ];

  if (reservation.calendarId) {
    params.push(`src=${encodeURIComponent(reservation.calendarId)}`);
  }

  return `https://calendar.google.com/calendar/render?${params.join("&")}`;
}

function getReservationSheet_() {
  const spreadsheetId = getOrCreateSpreadsheetId_();
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
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
      "calendar_link"
    ]);
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

function formatDateForCalendarParam_(value) {
  if (!value) {
    return "";
  }

  if (Object.prototype.toString.call(value) === "[object Date]" && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, SCRIPT_TZ, "yyyyMMdd");
  }

  const text = String(value).trim();
  const parsedDate = new Date(text);
  if (!Number.isNaN(parsedDate.getTime())) {
    return Utilities.formatDate(parsedDate, SCRIPT_TZ, "yyyyMMdd");
  }

  const parts = text.split("-");
  if (parts.length === 3) {
    return `${parts[0]}${parts[1]}${parts[2]}`;
  }

  return text.replace(/[^\d]/g, "");
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
