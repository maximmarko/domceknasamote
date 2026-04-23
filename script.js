(() => {
    document.documentElement.classList.add("js");
    const calendarTitle = document.querySelector("#calendar-title");
    const calendarGrid = document.querySelector("#calendar-grid");
    const calendarSection = document.querySelector(".availability-calendar");
    const calendarMain = document.querySelector(".availability-calendar-main");
    const selectionStatus = document.querySelector("#calendar-selection-status");
    const bookingPanel = document.querySelector("#booking-panel");
    const bookingFrom = document.querySelector("#booking-from");
    const bookingTo = document.querySelector("#booking-to");
    const bookingGuests = document.querySelector("#booking-guests");
    const bookingPayment = document.querySelector("#booking-payment");
    const bookingPriceList = document.querySelector("#booking-price-list");
    const bookingNights = document.querySelector("#booking-nights");
    const bookingTotal = document.querySelector("#booking-total");
    const bookingTotalOriginal = document.querySelector("#booking-total-original");
    const bookingNote = document.querySelector("#booking-note");
    const bookingSubmit = document.querySelector("#booking-submit");
    const bookingClear = document.querySelector("#booking-clear");
    const reservationSection = document.querySelector("#reservation-form-section");
    const reservationForm = document.querySelector("#reservation-form");
    const reservationSummaryDates = document.querySelector("#reservation-summary-dates");
    const reservationSummaryGuests = document.querySelector("#reservation-summary-guests");
    const reservationSummaryPayment = document.querySelector("#reservation-summary-payment");
    const reservationSummaryPrice = document.querySelector("#reservation-summary-price");
    const reservationError = document.querySelector("#reservation-form-error");
    const reservationStatus = document.querySelector("#reservation-form-status");
    const reservationRequiredConsent = document.querySelector("#reservation-consent-required");
    const reservationMarketingConsent = document.querySelector("#reservation-consent-marketing");
    const reservationFirstName = document.querySelector("#reservation-first-name");
    const reservationLastName = document.querySelector("#reservation-last-name");
    const reservationEmail = document.querySelector("#reservation-email");
    const reservationPhone = document.querySelector("#reservation-phone");
    const reservationStreet = document.querySelector("#reservation-street");
    const reservationCity = document.querySelector("#reservation-city");
    const reservationZip = document.querySelector("#reservation-zip");
    const reservationCountry = document.querySelector("#reservation-country");
    const reservationNotes = document.querySelector("#reservation-notes");
    const reservationFinalSubmit = document.querySelector("#reservation-final-submit");
    const mobileBookingHint = document.querySelector("#mobile-booking-hint");
    const mobileBookingHintDismiss = document.querySelector("#mobile-booking-hint-dismiss");
    const bookingConfig = window.BOOKING_CONFIG || {};
    const calendarTodayButton = calendarSection?.querySelector('[data-action="today"]');

    if (!calendarTitle || !calendarGrid || !calendarSection) {
        return;
    }

    const weekdayLabels = ["Po", "Ut", "St", "\u0160t", "Pi", "So", "Ne"];
    const monthNames = [
        "Janu\u00E1r",
        "Febru\u00E1r",
        "Marec",
        "Apr\u00EDl",
        "M\u00E1j",
        "J\u00FAn",
        "J\u00FAl",
        "August",
        "September",
        "Okt\u00F3ber",
        "November",
        "December",
    ];

    const calendarId = "8710a06546b2ee7d08b9b6faf00286be9036681f8092ec64150650c81adea127@group.calendar.google.com";
    const apiKey = "AIzaSyDo6fFMvGhf9QDMzlkPV6bKBPNYDHy6fUs";
    const refreshIntervalMs = 10 * 60 * 1000;
    const baseNightRate = Number(calendarSection.dataset.baseRate || 150);
    const reservationApiUrl = String(bookingConfig.endpoint || "").trim();
    const reservationOwnerEmail = String(bookingConfig.ownerEmail || "").trim();
    const approvalCalendarId = String(bookingConfig.approvalCalendarId || calendarId).trim();
    const visibleMonthCount = 2;
    let bookedDates = new Set();
    let loadedRange = null;
    let selectedStart = null;
    let selectedEnd = null;
    let isSubmittingReservation = false;
    let pointerSelectionActive = false;
    let pointerAnchorDate = null;
    let pointerCurrentDate = null;
    let pointerUsesExistingStart = false;
    let pointerSelectionStartBeforeDrag = null;
    let pointerSelectionEndBeforeDrag = null;
    let activePointerId = null;
    let suppressCalendarClick = false;
    let mobileBookingHintVisible = false;
    let mobileBookingHintShownThisSelection = false;
    let mobileBookingHintHideTimeout = null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const formatDateKey = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    };

    const parseDateKey = (dateKey) => {
        const [year, month, day] = dateKey.split("-").map(Number);
        return new Date(year, month - 1, day);
    };

    const compareDates = (left, right) => left.getTime() - right.getTime();

    const formatDisplayDate = (date) =>
        `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;

    const formatPrice = (value) =>
        new Intl.NumberFormat("sk-SK", {
            style: "currency",
            currency: "EUR",
            maximumFractionDigits: 0,
        }).format(value);

    const setReservationStatus = (state, message) => {
        if (!reservationStatus) {
            return;
        }

        if (!message) {
            reservationStatus.hidden = true;
            reservationStatus.textContent = "";
            reservationStatus.removeAttribute("data-state");
            return;
        }

        reservationStatus.hidden = false;
        reservationStatus.textContent = message;
        reservationStatus.dataset.state = state;
    };

    const setReservationSubmittingState = (submitting) => {
        isSubmittingReservation = submitting;
        if (!reservationFinalSubmit) {
            return;
        }

        reservationFinalSubmit.disabled = submitting;
        reservationFinalSubmit.textContent = submitting ? "Odosielam rezerváciu..." : "Rezervujte teraz";
    };

    const getInclusiveRange = (start, end) => {
        if (!start || !end) {
            return [];
        }

        const dates = [];
        const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const rangeEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());

        while (cursor <= rangeEnd) {
            dates.push(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()));
            cursor.setDate(cursor.getDate() + 1);
        }

        return dates;
    };

    const getStayNights = (start, end) => {
        if (!start || !end || compareDates(end, start) <= 0) {
            return [];
        }

        const nights = [];
        const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        while (cursor < end) {
            nights.push(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()));
            cursor.setDate(cursor.getDate() + 1);
        }
        return nights;
    };

    const isDateSelectable = (date) => date >= today && !bookedDates.has(formatDateKey(date));

    const isRangeSelectable = (start, end) => {
        if (!start || !end || compareDates(end, start) < 0) {
            return false;
        }
        return getInclusiveRange(start, end).every(isDateSelectable);
    };

    const getNightRate = () => baseNightRate;

    const getDiscountRate = (nightCount) => {
        if (nightCount >= 5) {
            return 0.15;
        }
        if (nightCount === 4) {
            return 0.1;
        }
        if (nightCount === 3) {
            return 0.05;
        }
        return 0;
    };

    const hasPricing = () => baseNightRate > 0;

    const hideReservationForm = () => {
        if (!reservationSection) {
            return;
        }
        reservationSection.hidden = true;
        if (reservationError) {
            reservationError.hidden = true;
        }
        setReservationStatus("", "");
    };

    const isMobileBookingHintEligible = () =>
        window.matchMedia("(max-width: 960px)").matches;

    const hideMobileBookingHint = () => {
        if (!mobileBookingHint) {
            return;
        }
        if (mobileBookingHintHideTimeout) {
            window.clearTimeout(mobileBookingHintHideTimeout);
            mobileBookingHintHideTimeout = null;
        }
        mobileBookingHint.classList.remove("is-visible");
        mobileBookingHint.classList.add("is-hiding");
        mobileBookingHintVisible = false;
        mobileBookingHintHideTimeout = window.setTimeout(() => {
            mobileBookingHint.hidden = true;
            mobileBookingHint.setAttribute("aria-hidden", "true");
            mobileBookingHint.classList.remove("is-hiding");
            mobileBookingHintHideTimeout = null;
        }, 220);
    };

    const scrollToBookingPanel = () => {
        if (!bookingPanel || bookingPanel.hidden) {
            return;
        }
        bookingPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const showMobileBookingHint = () => {
        if (!mobileBookingHint || !bookingPanel || bookingPanel.hidden) {
            return;
        }
        if (mobileBookingHintHideTimeout) {
            window.clearTimeout(mobileBookingHintHideTimeout);
            mobileBookingHintHideTimeout = null;
        }
        mobileBookingHint.hidden = false;
        mobileBookingHint.setAttribute("aria-hidden", "false");
        mobileBookingHint.classList.remove("is-hiding");
        requestAnimationFrame(() => {
            mobileBookingHint.classList.add("is-visible");
        });
        mobileBookingHintVisible = true;
        mobileBookingHintShownThisSelection = true;
    };

    const maybeShowMobileBookingHint = () => {
        if (!bookingPanel || bookingPanel.hidden) {
            hideMobileBookingHint();
            return;
        }

        if (!isMobileBookingHintEligible() || mobileBookingHintShownThisSelection) {
            return;
        }

        showMobileBookingHint();
    };

    const getFinalPrice = (nights) => {
        const originalTotal = nights.reduce((sum, nightDate) => sum + getNightRate(nightDate), 0);
        const discountRate = getDiscountRate(nights.length);
        return {
            originalTotal,
            discountRate,
            discountAmount: Math.round(originalTotal * discountRate),
            finalTotal: originalTotal - Math.round(originalTotal * discountRate),
        };
    };

    const resetSelection = () => {
        selectedStart = null;
        selectedEnd = null;
        mobileBookingHintShownThisSelection = false;
        hideMobileBookingHint();
        hideReservationForm();
    };

    const getResolvedSelection = (anchorDate, targetDate, keepExistingStart) => {
        if (!anchorDate || !targetDate) {
            return { start: null, end: null };
        }

        if (keepExistingStart) {
            if (compareDates(targetDate, anchorDate) <= 0) {
                return { start: targetDate, end: null };
            }

            if (!isRangeSelectable(anchorDate, targetDate)) {
                return { start: targetDate, end: null };
            }

            return { start: anchorDate, end: targetDate };
        }

        if (compareDates(targetDate, anchorDate) === 0) {
            return { start: anchorDate, end: null };
        }

        const start = compareDates(targetDate, anchorDate) < 0 ? targetDate : anchorDate;
        const end = compareDates(targetDate, anchorDate) < 0 ? anchorDate : targetDate;

        if (!isRangeSelectable(start, end)) {
            return { start: targetDate, end: null };
        }

        return { start, end };
    };

    const getDisplayedSelection = () => {
        if (!pointerSelectionActive || !pointerAnchorDate || !pointerCurrentDate) {
            return { start: selectedStart, end: selectedEnd };
        }

        return getResolvedSelection(pointerAnchorDate, pointerCurrentDate, pointerUsesExistingStart);
    };

    const updateSelectionStatus = () => {
        if (!selectionStatus) {
            return;
        }

        const { start, end } = getDisplayedSelection();

        if (start && end) {
            selectionStatus.textContent = `Vybraný pobyt: od ${formatDisplayDate(start)} do ${formatDisplayDate(end)}.`;
            return;
        }

        if (start) {
            selectionStatus.textContent = `Začiatok pobytu: ${formatDisplayDate(start)}. Vyberte alebo potiahnite po posledný deň pobytu.`;
            return;
        }

        selectionStatus.textContent = "Kliknite alebo potiahnite po voľných dňoch. Zobrazené sú dva mesiace naraz pre jednoduchší výber termínu.";
    };

    const updateBookingPanel = () => {
        if (
            !bookingPanel ||
            !bookingFrom ||
            !bookingTo ||
            !bookingPriceList ||
            !bookingNights ||
            !bookingTotal ||
            !bookingTotalOriginal ||
            !bookingNote ||
            !bookingSubmit
        ) {
            return;
        }

        const nights = getStayNights(selectedStart, selectedEnd);
        const canShowPanel = Boolean(selectedStart && selectedEnd && nights.length > 0);

        bookingPanel.hidden = !canShowPanel;
        if (!canShowPanel) {
            bookingSubmit.disabled = true;
            bookingTotalOriginal.hidden = true;
            mobileBookingHintShownThisSelection = false;
            hideMobileBookingHint();
            hideReservationForm();
            return;
        }

        bookingFrom.textContent = formatDisplayDate(selectedStart);
        bookingTo.textContent = formatDisplayDate(selectedEnd);
        bookingNights.textContent = `${nights.length} ${nights.length === 1 ? "noc" : nights.length <= 4 ? "noci" : "nocí"}`;

        if (hasPricing()) {
            const { originalTotal, discountRate, discountAmount, finalTotal } = getFinalPrice(nights);
            const itemsMarkup = nights
                .map((nightDate) => {
                    const rate = getNightRate(nightDate);
                    return `
                        <div class="booking-price-item">
                            <span>${formatDisplayDate(nightDate)}</span>
                            <strong>${formatPrice(rate)}</strong>
                        </div>
                    `;
                })
                .join("");

            const discountMarkup = discountRate > 0
                ? `
                    <div class="booking-price-summary">
                        <div class="booking-price-item booking-price-item--summary">
                            <span>Medzisúčet</span>
                            <strong>${formatPrice(originalTotal)}</strong>
                        </div>
                        <div class="booking-price-item booking-price-item--discount">
                            <span>Zľava za ${nights.length} ${nights.length === 1 ? "noc" : nights.length <= 4 ? "noci" : "nocí"} (${Math.round(discountRate * 100)}%)</span>
                            <strong>- ${formatPrice(discountAmount)}</strong>
                        </div>
                    </div>
                `
                : "";

            bookingPriceList.innerHTML = `${itemsMarkup}${discountMarkup}`;
            bookingTotal.textContent = formatPrice(finalTotal);
            bookingTotalOriginal.textContent = formatPrice(originalTotal);
            bookingTotalOriginal.hidden = discountRate <= 0;
        } else {
            bookingPriceList.innerHTML = '<p class="booking-price-placeholder">Cena pobytu bude potvrdená individuálne po odoslaní dopytu.</p>';
            bookingTotal.textContent = "Podľa výberu";
            bookingTotalOriginal.hidden = true;
        }

        const isReady = Boolean(bookingGuests?.value && bookingPayment?.value);
        bookingSubmit.disabled = !isReady;
        const discountRate = getDiscountRate(nights.length);
        bookingNote.textContent = isReady
            ? discountRate > 0
                ? `Po odoslaní žiadosti príde majiteľovi email na schválenie. V cene je započítaná zľava ${Math.round(discountRate * 100)}%.`
                : "Pokračujte na formulár rezervácie s vybraným termínom."
            : "Doplňte počet osôb a spôsob platby pre pokračovanie.";

        maybeShowMobileBookingHint();
    };

    const updateReservationSummary = () => {
        if (
            !reservationSummaryDates ||
            !reservationSummaryGuests ||
            !reservationSummaryPayment ||
            !reservationSummaryPrice ||
            !selectedStart ||
            !selectedEnd
        ) {
            return;
        }

        const nights = getStayNights(selectedStart, selectedEnd);
        const { discountRate, finalTotal } = getFinalPrice(nights);
        reservationSummaryDates.textContent = `Termín: ${formatDisplayDate(selectedStart)} - ${formatDisplayDate(selectedEnd)}`;
        reservationSummaryGuests.textContent = `Počet osôb: ${bookingGuests?.value || "-"}`;
        reservationSummaryPayment.textContent = `Platba: ${bookingPayment?.value || "-"}`;
        reservationSummaryPrice.textContent = discountRate > 0
            ? `Cena po zľave: ${formatPrice(finalTotal)}`
            : `Cena: ${formatPrice(finalTotal)}`;
    };

    const revealReservationForm = () => {
        if (!reservationSection) {
            return;
        }
        reservationSection.hidden = false;
        updateReservationSummary();
        reservationSection.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const getInputValue = (input) => (input?.value || "").trim();

    const buildReservationPayload = () => {
        if (!selectedStart || !selectedEnd) {
            return null;
        }

        const nights = getStayNights(selectedStart, selectedEnd);
        if (nights.length <= 0) {
            return null;
        }

        const { discountRate, finalTotal, originalTotal } = getFinalPrice(nights);

        return {
            ownerEmail: reservationOwnerEmail,
            calendarId: approvalCalendarId,
            startDate: formatDateKey(selectedStart),
            endDate: formatDateKey(selectedEnd),
            startDateLabel: formatDisplayDate(selectedStart),
            endDateLabel: formatDisplayDate(selectedEnd),
            nights: nights.length,
            guestCount: bookingGuests?.value || "",
            paymentMethod: bookingPayment?.value || "",
            originalPrice: originalTotal,
            originalPriceLabel: formatPrice(originalTotal),
            discountRate,
            totalPrice: finalTotal,
            totalPriceLabel: formatPrice(finalTotal),
            guestFirstName: getInputValue(reservationFirstName),
            guestLastName: getInputValue(reservationLastName),
            guestEmail: getInputValue(reservationEmail),
            guestPhone: getInputValue(reservationPhone),
            street: getInputValue(reservationStreet),
            city: getInputValue(reservationCity),
            zip: getInputValue(reservationZip),
            country: getInputValue(reservationCountry),
            notes: getInputValue(reservationNotes),
            consents: {
                required: Boolean(reservationRequiredConsent?.checked),
                marketing: Boolean(reservationMarketingConsent?.checked),
            },
        };
    };

    const renderMonthGrid = (monthDate, selectionStart, selectionEnd) => {
        const panel = document.createElement("section");
        panel.className = "calendar-month";

        const title = document.createElement("h3");
        title.className = "calendar-month-title";
        title.textContent = `${monthNames[monthDate.getMonth()]} ${monthDate.getFullYear()}`;
        panel.appendChild(title);

        const monthGrid = document.createElement("div");
        monthGrid.className = "calendar-month-grid";

        weekdayLabels.forEach((label) => {
            const cell = document.createElement("div");
            cell.className = "calendar-day";
            cell.textContent = label;
            monthGrid.appendChild(cell);
        });

        const year = monthDate.getFullYear();
        const month = monthDate.getMonth();
        const firstOfMonth = new Date(year, month, 1);
        const startIndex = (firstOfMonth.getDay() + 6) % 7;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const prevMonthDays = new Date(year, month, 0).getDate();

        for (let i = 0; i < startIndex; i += 1) {
            const day = prevMonthDays - startIndex + i + 1;
            const cell = document.createElement("div");
            cell.className = "calendar-cell muted";
            cell.textContent = String(day);
            monthGrid.appendChild(cell);
        }

        for (let day = 1; day <= daysInMonth; day += 1) {
            const cellDate = new Date(year, month, day);
            const cell = document.createElement("div");
            const dateKey = formatDateKey(cellDate);
            const isPast = cellDate < today;
            const hasStart = selectionStart && formatDateKey(selectionStart) === dateKey;
            const hasEnd = selectionEnd && formatDateKey(selectionEnd) === dateKey;
            const isInRange =
                selectionStart &&
                selectionEnd &&
                compareDates(cellDate, selectionStart) >= 0 &&
                compareDates(cellDate, selectionEnd) <= 0;

            if (bookedDates.has(dateKey)) {
                cell.className = "calendar-cell booked";
            } else if (isPast) {
                cell.className = "calendar-cell unavailable";
            } else {
                cell.className = "calendar-cell available";
                cell.dataset.date = dateKey;
                cell.setAttribute("role", "button");
                cell.setAttribute("tabindex", "0");
            }

            if (hasStart && hasEnd) {
                cell.classList.add("selected-single");
            } else if (hasStart) {
                cell.classList.add("selected-start");
            } else if (hasEnd) {
                cell.classList.add("selected-end");
            } else if (isInRange) {
                cell.classList.add("selected-range");
            }

            if (pointerSelectionActive && hasStart && !hasEnd) {
                cell.classList.add("selection-anchor");
            }

            cell.textContent = String(day);
            monthGrid.appendChild(cell);
        }

        const totalCells = weekdayLabels.length + startIndex + daysInMonth;
        const remainingCells = 7 - (totalCells % 7 || 7);

        for (let i = 1; i <= remainingCells; i += 1) {
            const cell = document.createElement("div");
            cell.className = "calendar-cell muted";
            cell.textContent = String(i);
            monthGrid.appendChild(cell);
        }

        panel.appendChild(monthGrid);
        return panel;
    };

    const renderCalendar = () => {
        calendarGrid.innerHTML = "";
        const { start: displayStart, end: displayEnd } = getDisplayedSelection();

        for (let index = 0; index < visibleMonthCount; index += 1) {
            const monthDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + index, 1);
            calendarGrid.appendChild(renderMonthGrid(monthDate, displayStart, displayEnd));
        }

        const secondVisibleMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + visibleMonthCount - 1, 1);
        calendarTitle.textContent = `${monthNames[currentMonth.getMonth()]} ${currentMonth.getFullYear()} - ${monthNames[secondVisibleMonth.getMonth()]} ${secondVisibleMonth.getFullYear()}`;
        updateSelectionStatus();
        updateBookingPanel();
    };

    const addRangeToBooked = (targetSet, startDate, endDate) => {
        const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
        while (cursor < end) {
            targetSet.add(formatDateKey(cursor));
            cursor.setDate(cursor.getDate() + 1);
        }
    };

    const fetchBookings = async () => {
        const rangeStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const rangeEnd = new Date(today.getFullYear(), today.getMonth() + 13, 1);
        loadedRange = { start: rangeStart, end: rangeEnd };

        const timeMin = rangeStart.toISOString();
        const timeMax = rangeEnd.toISOString();
        const encodedId = encodeURIComponent(calendarId);
        const url =
            `https://www.googleapis.com/calendar/v3/calendars/${encodedId}/events` +
            `?key=${apiKey}&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}` +
            `&timeMax=${encodeURIComponent(timeMax)}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                return;
            }
            const data = await response.json();
            const nextBooked = new Set();

            (data.items || []).forEach((event) => {
                const start = event.start?.dateTime || event.start?.date;
                const end = event.end?.dateTime || event.end?.date;
                if (!start || !end) {
                    return;
                }

                const startDate = new Date(start);
                const endDate = new Date(end);
                addRangeToBooked(nextBooked, startDate, endDate);
            });

            bookedDates = nextBooked;
        } catch (error) {
            return;
        }
    };

    const shiftMonth = (direction) => {
        currentMonth = new Date(
            currentMonth.getFullYear(),
            currentMonth.getMonth() + direction,
            1
        );
        const visibleRangeEnd = new Date(
            currentMonth.getFullYear(),
            currentMonth.getMonth() + visibleMonthCount,
            1
        );
        if (
            loadedRange &&
            (currentMonth < loadedRange.start || visibleRangeEnd > loadedRange.end)
        ) {
            fetchBookings().then(() => {
                syncSelectionWithAvailability();
                renderCalendar();
            });
            return;
        }
        renderCalendar();
    };

    const goToCurrentMonth = () => {
        const isAlreadyOnCurrentMonth =
            currentMonth.getFullYear() === today.getFullYear() &&
            currentMonth.getMonth() === today.getMonth();

        if (isAlreadyOnCurrentMonth) {
            calendarTodayButton?.classList.remove("calendar-today-pulse");
            void calendarTodayButton?.offsetWidth;
            calendarTodayButton?.classList.add("calendar-today-pulse");

            calendarMain?.classList.remove("calendar-current-highlight");
            void calendarMain?.offsetWidth;
            calendarMain?.classList.add("calendar-current-highlight");

            window.setTimeout(() => {
                calendarTodayButton?.classList.remove("calendar-today-pulse");
                calendarMain?.classList.remove("calendar-current-highlight");
            }, 900);
            return;
        }

        currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        renderCalendar();
    };

    const selectDate = (date) => {
        if (!isDateSelectable(date)) {
            return;
        }

        hideReservationForm();

        if (!selectedStart || (selectedStart && selectedEnd)) {
            selectedStart = date;
            selectedEnd = null;
            renderCalendar();
            return;
        }

        if (compareDates(date, selectedStart) <= 0) {
            selectedStart = date;
            selectedEnd = null;
            renderCalendar();
            return;
        }

        if (!isRangeSelectable(selectedStart, date)) {
            selectedStart = date;
            selectedEnd = null;
            renderCalendar();
            return;
        }

        selectedEnd = date;
        renderCalendar();
    };

    const beginPointerSelection = (date) => {
        if (!isDateSelectable(date)) {
            return;
        }

        suppressCalendarClick = true;
        hideReservationForm();
        pointerSelectionStartBeforeDrag = selectedStart;
        pointerSelectionEndBeforeDrag = selectedEnd;
        pointerUsesExistingStart = Boolean(selectedStart && !selectedEnd);
        pointerAnchorDate = pointerUsesExistingStart ? selectedStart : date;
        pointerCurrentDate = date;
        pointerSelectionActive = true;
        renderCalendar();
    };

    const updatePointerSelection = (date) => {
        if (!pointerSelectionActive || !date || !isDateSelectable(date)) {
            return;
        }

        const dateKey = formatDateKey(date);
        const currentKey = pointerCurrentDate ? formatDateKey(pointerCurrentDate) : "";
        if (dateKey === currentKey) {
            return;
        }

        pointerCurrentDate = date;
        renderCalendar();
    };

    const finishPointerSelection = () => {
        if (!pointerSelectionActive || !pointerAnchorDate || !pointerCurrentDate) {
            pointerSelectionActive = false;
            pointerAnchorDate = null;
            pointerCurrentDate = null;
            pointerUsesExistingStart = false;
            pointerSelectionStartBeforeDrag = null;
            pointerSelectionEndBeforeDrag = null;
            activePointerId = null;
            return;
        }

        const resolved = getResolvedSelection(pointerAnchorDate, pointerCurrentDate, pointerUsesExistingStart);
        selectedStart = resolved.start;
        selectedEnd = resolved.end;

        pointerSelectionActive = false;
        pointerAnchorDate = null;
        pointerCurrentDate = null;
        pointerUsesExistingStart = false;
        pointerSelectionStartBeforeDrag = null;
        pointerSelectionEndBeforeDrag = null;
        activePointerId = null;
        renderCalendar();
    };

    const cancelPointerSelection = () => {
        selectedStart = pointerSelectionStartBeforeDrag;
        selectedEnd = pointerSelectionEndBeforeDrag;
        pointerSelectionActive = false;
        pointerAnchorDate = null;
        pointerCurrentDate = null;
        pointerUsesExistingStart = false;
        pointerSelectionStartBeforeDrag = null;
        pointerSelectionEndBeforeDrag = null;
        activePointerId = null;
        renderCalendar();
    };

    const getDateCellFromPoint = (clientX, clientY) => {
        const target = document.elementFromPoint(clientX, clientY);
        if (!(target instanceof HTMLElement)) {
            return null;
        }

        const dateTarget = target.closest("[data-date]");
        if (!(dateTarget instanceof HTMLElement)) {
            return null;
        }

        const dateKey = dateTarget.getAttribute("data-date");
        return dateKey ? parseDateKey(dateKey) : null;
    };

    const syncSelectionWithAvailability = () => {
        if (selectedStart && !isDateSelectable(selectedStart)) {
            resetSelection();
            return;
        }

        if (selectedStart && selectedEnd && !isRangeSelectable(selectedStart, selectedEnd)) {
            resetSelection();
        }
    };

    calendarSection.addEventListener("click", (event) => {
        event.stopPropagation();
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        if (suppressCalendarClick) {
            suppressCalendarClick = false;
            return;
        }

        const action = target.getAttribute("data-action");
        if (action === "prev") {
            shiftMonth(-1);
        }
        if (action === "next") {
            shiftMonth(1);
        }
        if (action === "today") {
            goToCurrentMonth();
        }

        const dateTarget = target.closest("[data-date]");
        if (dateTarget instanceof HTMLElement) {
            const dateKey = dateTarget.getAttribute("data-date");
            if (dateKey) {
                selectDate(parseDateKey(dateKey));
            }
        }
    });

    calendarSection.addEventListener("keydown", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.matches("[data-date]")) {
            return;
        }

        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }

        event.preventDefault();
        const dateKey = target.getAttribute("data-date");
        if (!dateKey) {
            return;
        }
        selectDate(parseDateKey(dateKey));
    });

    bookingPanel?.addEventListener("click", (event) => {
        event.stopPropagation();
    });

    mobileBookingHintDismiss?.addEventListener("click", (event) => {
        event.stopPropagation();
        hideMobileBookingHint();
        scrollToBookingPanel();
    });

    window.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !mobileBookingHintVisible) {
            return;
        }
        hideMobileBookingHint();
    });

    reservationSection?.addEventListener("click", (event) => {
        event.stopPropagation();
    });

    calendarGrid.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) {
            return;
        }

        const date = getDateCellFromPoint(event.clientX, event.clientY);
        if (!date) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        activePointerId = event.pointerId;
        if (typeof calendarGrid.setPointerCapture === "function") {
            calendarGrid.setPointerCapture(event.pointerId);
        }
        beginPointerSelection(date);
    });

    calendarGrid.addEventListener("pointermove", (event) => {
        if (!pointerSelectionActive || (activePointerId !== null && event.pointerId !== activePointerId)) {
            return;
        }

        const date = getDateCellFromPoint(event.clientX, event.clientY);
        if (!date) {
            return;
        }

        event.preventDefault();
        updatePointerSelection(date);
    });

    window.addEventListener("pointerup", (event) => {
        if (activePointerId !== null && event.pointerId !== activePointerId) {
            return;
        }
        finishPointerSelection();
    });

    window.addEventListener("pointercancel", (event) => {
        if (activePointerId !== null && event.pointerId !== activePointerId) {
            return;
        }
        cancelPointerSelection();
    });

    document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        if (!selectedStart && !selectedEnd) {
            return;
        }

        const clickedInsideInteractiveArea =
            target.closest("[data-date]") ||
            target.closest("[data-action]") ||
            target.closest("#booking-panel") ||
            target.closest("#reservation-form-section");

        if (!clickedInsideInteractiveArea) {
            resetSelection();
            renderCalendar();
        }
    });

    bookingGuests?.addEventListener("change", updateBookingPanel);
    bookingGuests?.addEventListener("change", () => {
        hideMobileBookingHint();
        hideReservationForm();
    });
    bookingPayment?.addEventListener("change", updateBookingPanel);
    bookingPayment?.addEventListener("change", () => {
        hideMobileBookingHint();
        hideReservationForm();
    });
    bookingClear?.addEventListener("click", () => {
        resetSelection();
        renderCalendar();
    });
    bookingSubmit?.addEventListener("click", () => {
        if (!selectedStart || !selectedEnd || !bookingGuests?.value || !bookingPayment?.value) {
            return;
        }
        hideMobileBookingHint();
        revealReservationForm();
    });

    reservationForm?.addEventListener("input", () => {
        if (reservationError) {
            reservationError.hidden = true;
        }
        setReservationStatus("", "");
    });

    reservationForm?.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (isSubmittingReservation) {
            return;
        }

        const requiredValid =
            Boolean(getInputValue(reservationEmail)) &&
            Boolean(getInputValue(reservationPhone)) &&
            Boolean(reservationRequiredConsent?.checked);

        if (!requiredValid || !reservationForm.reportValidity()) {
            if (reservationError) {
                reservationError.hidden = false;
            }
            return;
        }

        if (reservationError) {
            reservationError.hidden = true;
        }

        if (!reservationApiUrl) {
            setReservationStatus(
                "error",
                "Rezervačný formulár ešte nie je prepojený na odosielací endpoint. Doplňte window.BOOKING_CONFIG.endpoint."
            );
            return;
        }

        const payload = buildReservationPayload();
        if (!payload) {
            setReservationStatus("error", "Nepodarilo sa pripraviť údaje rezervácie. Skontrolujte vybraný termín.");
            return;
        }

        setReservationSubmittingState(true);
        setReservationStatus("", "");

        try {
            const response = await fetch(reservationApiUrl, {
                method: "POST",
                mode: "no-cors",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8",
                },
                body: JSON.stringify(payload),
            });

            let result = null;
            if (response.type !== "opaque") {
                try {
                    result = await response.json();
                } catch (error) {
                    result = null;
                }
            }

            if (response.type !== "opaque" && (!response.ok || result?.success === false)) {
                throw new Error(result?.message || "Rezerváciu sa nepodarilo odoslať.");
            }

            reservationForm.reset();
            if (reservationError) {
                reservationError.hidden = true;
            }
            setReservationStatus(
                "success",
                result?.message || "Rezervačná žiadosť bola odoslaná. Ak bol endpoint správne nasadený, na email vám príde potvrdenie o prijatí."
            );
        } catch (error) {
            setReservationStatus(
                "error",
                error instanceof Error && error.message
                    ? error.message
                    : "Rezerváciu sa nepodarilo odoslať. Skúste to znova."
            );
        } finally {
            setReservationSubmittingState(false);
        }
    });

    fetchBookings()
        .then(() => {
            syncSelectionWithAvailability();
            renderCalendar();
        })
        .catch(() => {
            renderCalendar();
        });
    setInterval(() => {
        fetchBookings().then(() => {
            syncSelectionWithAvailability();
            renderCalendar();
        });
    }, refreshIntervalMs);
})();

(() => {
    const banner = document.querySelector("#cookie-banner");
    const acceptButton = document.querySelector("#cookie-banner-accept");

    if (!banner || !acceptButton) {
        return;
    }

    const consentCookieName = "chalupka_cookie_consent";

    const getCookie = (name) => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
        return match ? decodeURIComponent(match[1]) : "";
    };

    const setCookie = (name, value, days) => {
        const expires = new Date(Date.now() + (days * 24 * 60 * 60 * 1000)).toUTCString();
        document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
    };

    if (getCookie(consentCookieName) === "accepted") {
        banner.hidden = true;
        return;
    }

    banner.hidden = false;
    acceptButton.addEventListener("click", () => {
        setCookie(consentCookieName, "accepted", 180);
        banner.hidden = true;
    });
})();

(() => {
    const video = document.querySelector("#intro-video");
    const fallbackMessage = document.querySelector("#intro-video-fallback");
    if (!video) {
        return;
    }

    const updateFullscreenState = () => {
        const isFullscreen = document.fullscreenElement === video;
        if (isFullscreen) {
            video.muted = false;
            video.controls = true;
        } else {
            video.muted = true;
            video.controls = false;
        }
    };

    const showFallback = () => {
        if (fallbackMessage) {
            fallbackMessage.hidden = false;
        }
    };

    const hideFallback = () => {
        if (fallbackMessage) {
            fallbackMessage.hidden = true;
        }
    };

    const tryPlayback = () => {
        video.muted = true;
        video.defaultMuted = true;

        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(showFallback);
        }
    };

    video.addEventListener("loadeddata", () => {
        hideFallback();
    });

    video.addEventListener("canplay", () => {
        tryPlayback();
    });

    video.addEventListener("playing", () => {
        hideFallback();
    });

    video.addEventListener("error", () => {
        showFallback();
    });

    document.addEventListener("fullscreenchange", updateFullscreenState);
    updateFullscreenState();
    tryPlayback();
})();

(() => {
    const items = Array.from(document.querySelectorAll(".faq-item"));
    if (items.length === 0) {
        return;
    }

    items.forEach((item) => {
        const summary = item.querySelector("summary");
        const content = item.querySelector("p");
        if (!summary || !content) {
            return;
        }

        summary.addEventListener("click", (event) => {
            event.preventDefault();
            if (item.dataset.animating === "true") {
                return;
            }
            item.dataset.animating = "true";
            if (item.hasAttribute("open")) {
                const startHeight = content.getBoundingClientRect().height;
                content.style.height = `${startHeight}px`;
                content.style.opacity = "1";
                content.style.transform = "translateY(0)";

                requestAnimationFrame(() => {
                    content.style.height = "0px";
                    content.style.opacity = "0";
                    content.style.transform = "translateY(-6px)";
                });

                const onClose = () => {
                    item.removeAttribute("open");
                    content.style.height = "";
                    content.style.opacity = "";
                    content.style.transform = "";
                    item.dataset.animating = "false";
                    content.removeEventListener("transitionend", onClose);
                };
                content.addEventListener("transitionend", onClose);
            } else {
                item.setAttribute("open", "");
                const targetHeight = content.scrollHeight;
                content.style.height = "0px";
                content.style.opacity = "0";
                content.style.transform = "translateY(-6px)";

                requestAnimationFrame(() => {
                    content.style.height = `${targetHeight}px`;
                    content.style.opacity = "1";
                    content.style.transform = "translateY(0)";
                });

                const onOpen = () => {
                    content.style.height = "";
                    content.removeEventListener("transitionend", onOpen);
                    item.dataset.animating = "false";
                };
                content.addEventListener("transitionend", onOpen);
            }
        });
    });
})();

(() => {
    const animated = Array.from(document.querySelectorAll("[data-animate]"));
    if (animated.length === 0) {
        return;
    }

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add("in-view");
                    observer.unobserve(entry.target);
                }
            });
        },
        { threshold: 0.2 }
    );

    animated.forEach((el) => observer.observe(el));
})();

(() => {
    const gallery = document.querySelector(".gallery-grid");
    const lightbox = document.querySelector(".lightbox");
    if (!gallery || !lightbox) {
        return;
    }

    const cards = Array.from(gallery.querySelectorAll(".gallery-card"));
    const image = lightbox.querySelector(".lightbox-image");
    const caption = lightbox.querySelector(".lightbox-caption");
    const count = lightbox.querySelector(".lightbox-count");
    const closeButtons = Array.from(lightbox.querySelectorAll('[data-action="close"]'));
    const prevButton = lightbox.querySelector('[data-action="prev"]');
    const nextButton = lightbox.querySelector('[data-action="next"]');

    if (!image || !caption || !count) {
        return;
    }

    const items = cards.map((card) => {
        const img = card.querySelector("img");
        const label = card.querySelector(".gallery-card-label");
        return {
            src: card.getAttribute("data-gallery-src") || (img ? img.src : ""),
            alt: img ? img.getAttribute("alt") || "" : "",
            label: label ? label.textContent.trim() : "",
        };
    });

    let currentIndex = 0;

    const openAt = (index) => {
        const item = items[index];
        if (!item) {
            return;
        }
        currentIndex = index;
        image.src = item.src;
        image.alt = item.alt;
        caption.textContent = item.label;
        count.textContent = `${index + 1} / ${items.length}`;
        lightbox.classList.add("is-open");
        lightbox.setAttribute("aria-hidden", "false");
        document.body.classList.add("lightbox-open");
        updateNavState();
    };

    const close = () => {
        lightbox.classList.remove("is-open");
        lightbox.setAttribute("aria-hidden", "true");
        document.body.classList.remove("lightbox-open");
    };

    const updateNavState = () => {
        if (prevButton) {
            const isDisabled = currentIndex === 0;
            prevButton.classList.toggle("is-disabled", isDisabled);
            prevButton.disabled = isDisabled;
        }
        if (nextButton) {
            const isDisabled = currentIndex === items.length - 1;
            nextButton.classList.toggle("is-disabled", isDisabled);
            nextButton.disabled = isDisabled;
        }
    };

    const go = (direction) => {
        const nextIndex = currentIndex + direction;
        if (nextIndex < 0 || nextIndex >= items.length) {
            return;
        }
        openAt(nextIndex);
    };

    cards.forEach((card, index) => {
        card.addEventListener("click", () => openAt(index));
    });

    closeButtons.forEach((button) => {
        button.addEventListener("click", close);
    });

    if (prevButton) {
        prevButton.addEventListener("click", () => go(-1));
    }

    if (nextButton) {
        nextButton.addEventListener("click", () => go(1));
    }

    let touchStartX = 0;
    let touchStartY = 0;
    const swipeThreshold = 40;

    lightbox.addEventListener("touchstart", (event) => {
        if (!lightbox.classList.contains("is-open")) {
            return;
        }
        const touch = event.changedTouches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
    }, { passive: true });

    lightbox.addEventListener("touchend", (event) => {
        if (!lightbox.classList.contains("is-open")) {
            return;
        }
        const touch = event.changedTouches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;

        if (Math.abs(deltaX) < swipeThreshold || Math.abs(deltaX) < Math.abs(deltaY)) {
            return;
        }

        go(deltaX > 0 ? -1 : 1);
    }, { passive: true });

    document.addEventListener("keydown", (event) => {
        if (!lightbox.classList.contains("is-open")) {
            return;
        }
        if (event.key === "Escape") {
            close();
        }
        if (event.key === "ArrowLeft") {
            go(-1);
        }
        if (event.key === "ArrowRight") {
            go(1);
        }
    });
})();

(() => {
    const lightbox = document.querySelector(".lightbox--info");
    if (!lightbox) {
        return;
    }

    const image = lightbox.querySelector(".lightbox-image");
    const caption = lightbox.querySelector(".lightbox-caption");
    const count = lightbox.querySelector(".lightbox-count");
    const driveButton = lightbox.querySelector("#lightbox-drive-btn");
    const walkButton = lightbox.querySelector("#lightbox-walk-btn");
    const closeButtons = Array.from(lightbox.querySelectorAll('[data-action="close"]'));

    if (!image || !caption || !count || !driveButton || !walkButton) {
        return;
    }

    const close = () => {
        lightbox.classList.remove("is-open");
        lightbox.setAttribute("aria-hidden", "true");
        document.body.classList.remove("lightbox-open");
    };

    window.openMapLightbox = ({
        src,
        alt = "",
        title = "",
        description = "",
        navigationUrl = "",
        driveNavigationUrl = "",
        walkNavigationUrl = "",
        driveLabel = "Trasa",
        walkLabel = "Pešo"
    }) => {
        if (!src) {
            return;
        }
        image.src = src;
        image.alt = alt;
        count.textContent = title;
        caption.textContent = description;
        const driveUrl = driveNavigationUrl || navigationUrl || "";
        driveButton.href = driveUrl || "#";
        driveButton.hidden = !driveUrl;
        driveButton.textContent = driveUrl && walkNavigationUrl ? driveLabel || "Autom" : driveLabel || "Trasa";
        walkButton.href = walkNavigationUrl || "#";
        walkButton.toggleAttribute("hidden", !walkNavigationUrl);
        walkButton.style.display = walkNavigationUrl ? "" : "none";
        walkButton.textContent = walkLabel || "Pešo";
        lightbox.classList.add("is-open");
        lightbox.setAttribute("aria-hidden", "false");
        document.body.classList.add("lightbox-open");
    };

    closeButtons.forEach((button) => {
        button.addEventListener("click", close);
    });

    document.addEventListener("keydown", (event) => {
        if (!lightbox.classList.contains("is-open")) {
            return;
        }
        if (event.key === "Escape") {
            close();
        }
    });
})();

(() => {
    const strip = document.querySelector(".social-strip");
    const prev = document.querySelector(".social-arrow.prev");
    const next = document.querySelector(".social-arrow.next");
    const progressFill = document.querySelector(".social-progress-fill");
    if (!strip) {
        return;
    }
    const hasArrowControls = Boolean(prev && next);

    const getCardStep = () => {
        const card = strip.querySelector(".social-card");
        if (!card) {
            return 0;
        }
        const gap = parseFloat(getComputedStyle(strip).columnGap || "0");
        return card.getBoundingClientRect().width + gap;
    };

    const updateProgress = () => {
        if (!progressFill) {
            return;
        }

        const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
        const progress = maxScroll > 0 ? strip.scrollLeft / maxScroll : 0;
        const fillPercent = progress * 100;
        progressFill.style.width = `${fillPercent}%`;
        progressFill.style.transform = "translateX(0)";
    };

    const updateArrowState = () => {
        if (!hasArrowControls) {
            return;
        }
        const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
        const atStart = strip.scrollLeft <= 1;
        const atEnd = strip.scrollLeft >= maxScroll - 1;

        prev.classList.toggle("is-disabled", atStart);
        prev.disabled = atStart;
        next.classList.toggle("is-disabled", atEnd);
        next.disabled = atEnd;
    };

    const scrollByCard = (direction) => {
        const amount = getCardStep();
        if (!amount) {
            return;
        }
        strip.scrollBy({ left: amount * direction, behavior: "smooth" });
    };

    const dragThreshold = 8;
    let pointerId = null;
    let pointerDown = false;
    let dragging = false;
    let suppressClick = false;
    let startX = 0;
    let startScrollLeft = 0;
    let lastX = 0;
    let lastMoveTime = 0;
    let velocityX = 0;
    let momentumFrame = null;
    let momentumLastTime = 0;

    const stopMomentum = () => {
        if (momentumFrame !== null) {
            window.cancelAnimationFrame(momentumFrame);
            momentumFrame = null;
        }
    };

    const snapToNearestCard = () => {
        const step = getCardStep();
        if (!step) {
            return;
        }
        const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
        const snapped = Math.round(strip.scrollLeft / step) * step;
        const target = Math.min(maxScroll, Math.max(0, snapped));
        strip.scrollTo({ left: target, behavior: "smooth" });
    };

    const startMomentum = () => {
        let momentumVelocity = -velocityX;
        if (Math.abs(momentumVelocity) < 0.03) {
            snapToNearestCard();
            return;
        }

        stopMomentum();
        momentumLastTime = performance.now();

        const stepMomentum = (now) => {
            const dt = now - momentumLastTime;
            momentumLastTime = now;
            const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);

            strip.scrollLeft = Math.min(
                maxScroll,
                Math.max(0, strip.scrollLeft + momentumVelocity * dt)
            );

            const hitBoundary = strip.scrollLeft <= 0 || strip.scrollLeft >= maxScroll;
            momentumVelocity *= Math.pow(0.94, dt / 16);

            if (hitBoundary || Math.abs(momentumVelocity) < 0.02) {
                momentumFrame = null;
                snapToNearestCard();
                return;
            }

            momentumFrame = window.requestAnimationFrame(stepMomentum);
        };

        momentumFrame = window.requestAnimationFrame(stepMomentum);
    };

    const onPointerDown = (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) {
            return;
        }
        stopMomentum();
        pointerDown = true;
        dragging = false;
        pointerId = event.pointerId;
        startX = event.clientX;
        startScrollLeft = strip.scrollLeft;
        lastX = event.clientX;
        lastMoveTime = performance.now();
        velocityX = 0;
        strip.classList.add("is-pointer-down");
        strip.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event) => {
        if (!pointerDown || pointerId !== event.pointerId) {
            return;
        }

        const deltaX = event.clientX - startX;
        if (!dragging && Math.abs(deltaX) > dragThreshold) {
            dragging = true;
            suppressClick = true;
            strip.classList.add("is-dragging");
        }

        if (!dragging) {
            return;
        }

        event.preventDefault();
        strip.scrollLeft = startScrollLeft - deltaX;
        const now = performance.now();
        const dt = now - lastMoveTime;
        if (dt > 0) {
            velocityX = (event.clientX - lastX) / dt;
        }
        lastX = event.clientX;
        lastMoveTime = now;
    };

    const finishPointerInteraction = (withMomentum) => {
        const hadDrag = dragging;
        pointerDown = false;
        pointerId = null;
        strip.classList.remove("is-pointer-down");
        strip.classList.remove("is-dragging");
        if (withMomentum && hadDrag) {
            startMomentum();
        }
    };

    const onPointerEnd = (event) => {
        if (pointerId !== event.pointerId) {
            return;
        }
        finishPointerInteraction(true);
    };

    const onPointerCancel = (event) => {
        if (pointerId !== event.pointerId) {
            return;
        }
        finishPointerInteraction(false);
    };

    strip.addEventListener("pointerdown", onPointerDown);
    strip.addEventListener("pointermove", onPointerMove);
    strip.addEventListener("pointerup", onPointerEnd);
    strip.addEventListener("pointercancel", onPointerCancel);
    strip.addEventListener("lostpointercapture", () => {
        pointerDown = false;
        pointerId = null;
        velocityX = 0;
        strip.classList.remove("is-pointer-down");
        strip.classList.remove("is-dragging");
    });
    strip.addEventListener("dragstart", (event) => {
        event.preventDefault();
    });

    strip.addEventListener("click", (event) => {
        if (!suppressClick) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        suppressClick = false;
    }, true);

    strip.addEventListener("pointerup", () => {
        window.setTimeout(() => {
            suppressClick = false;
        }, 0);
    });

    if (hasArrowControls) {
        prev.addEventListener("click", () => {
            stopMomentum();
            scrollByCard(-1);
        });
        next.addEventListener("click", () => {
            stopMomentum();
            scrollByCard(1);
        });
    }
    strip.addEventListener("scroll", () => {
        window.requestAnimationFrame(() => {
            updateProgress();
            updateArrowState();
        });
    });
    window.addEventListener("resize", () => {
        updateProgress();
        updateArrowState();
    });
    updateProgress();
    updateArrowState();
})();

(() => {
    const bookingLinks = Array.from(
        document.querySelectorAll('.topbar .nav a[href="obsadenost.html"]')
    );
    const hero = document.querySelector(".hero");

    bookingLinks.forEach((link) => {
        link.classList.add("booking-nav-link");
        if (!link.querySelector(".booking-nav-link-label")) {
            const label = document.createElement("span");
            label.className = "booking-nav-link-label";
            label.innerHTML = link.innerHTML;

            const orbit = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            orbit.setAttribute("class", "booking-nav-link-orbit");
            orbit.setAttribute("viewBox", "0 0 168 52");
            orbit.setAttribute("preserveAspectRatio", "none");
            orbit.setAttribute("aria-hidden", "true");

            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("x", "4");
            rect.setAttribute("y", "4");
            rect.setAttribute("width", "160");
            rect.setAttribute("height", "44");
            rect.setAttribute("rx", "22");
            rect.setAttribute("ry", "22");
            rect.setAttribute("pathLength", "100");

            orbit.appendChild(rect);
            link.innerHTML = "";
            link.append(label, orbit);
        }
    });

    if (bookingLinks.length === 0 || !hero) {
        return;
    }

    let hasActivated = false;
    let cycleTimeout = null;
    let clearTimeoutId = null;

    const stopCycle = () => {
        if (cycleTimeout) {
            window.clearTimeout(cycleTimeout);
            cycleTimeout = null;
        }
        if (clearTimeoutId) {
            window.clearTimeout(clearTimeoutId);
            clearTimeoutId = null;
        }
        document.body.classList.remove("booking-nav-accent-on");
    };

    const runCycle = () => {
        document.body.classList.add("booking-nav-accent-on");
        clearTimeoutId = window.setTimeout(() => {
            document.body.classList.remove("booking-nav-accent-on");
            clearTimeoutId = null;
        }, 1820);

        cycleTimeout = window.setTimeout(() => {
            cycleTimeout = null;
            runCycle();
        }, 7200);
    };

    const activateOnFirstScroll = () => {
        if (hasActivated || window.scrollY <= 24) {
            return;
        }
        hasActivated = true;
        runCycle();
    };

    window.addEventListener("scroll", activateOnFirstScroll, { passive: true });
    window.addEventListener("beforeunload", stopCycle);
})();

(() => {
    const toggle = document.querySelector(".menu-toggle");
    const mobileNav = document.querySelector(".mobile-nav");
    if (!toggle || !mobileNav) {
        return;
    }

    const updateState = (isOpen) => {
        document.body.classList.toggle("menu-open", isOpen);
        toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    };

    const setOpen = (isOpen) => {
        updateState(isOpen);
    };

    const syncFromWidth = () => {
        const isDesktop = window.innerWidth > 960;
        if (isDesktop) {
            updateState(false);
        }
    };

    toggle.addEventListener("click", () => {
        const isOpen = document.body.classList.contains("menu-open");
        setOpen(!isOpen);
    });

    mobileNav.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof HTMLAnchorElement) {
            setOpen(false);
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            setOpen(false);
        }
    });

    window.addEventListener("resize", syncFromWidth);
    syncFromWidth();
})();

(() => {
    const mapCanvas = document.querySelector("#map-canvas");
    const list = document.querySelector("#mapa-list");
    const status = document.querySelector("#map-status");
    const fullscreenToggle = document.querySelector("#mapa-fullscreen-toggle");
    const fullscreenLabel = fullscreenToggle ? fullscreenToggle.querySelector(".mapa-fullscreen-label") : null;
    const zoomInButton = document.querySelector("#mapa-zoom-in");
    const zoomOutButton = document.querySelector("#mapa-zoom-out");
    const layout = document.querySelector(".mapa-layout");
    const filterButtons = Array.from(document.querySelectorAll(".mapa-filter"));
    const hasList = Boolean(list);
    const hasFilters = filterButtons.length > 0;
    if (
        !mapCanvas ||
        !status ||
        !fullscreenToggle ||
        !fullscreenLabel ||
        !zoomInButton ||
        !zoomOutButton ||
        !layout
    ) {
        return;
    }

    const fallbackLocations = [
        {
            title: "Dom\u010Dek na samote",
            description: "Hlavna lokalita",
            lat: 48.776715805040354,
            lng: 19.65578883211096,
            season: "always",
            url: "https://maps.google.com/?q=48.776715805040354,19.65578883211096"
        }
    ];

    const cfg = window.MAPA_CONFIG || {};
    const apiKey = (cfg.apiKey || "").trim();
    const mapId = (cfg.mapId || "").trim();
    const mapTypeId = String(cfg.mapTypeId || "roadmap").toLowerCase();
    const preserveCameraOnMarkerOpen = Boolean(cfg.preserveCameraOnMarkerOpen);
    const routePath = Array.isArray(cfg.routePath)
        ? cfg.routePath
            .map((point) => ({
                lat: Number(point?.lat),
                lng: Number(point?.lng)
            }))
            .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
        : [];
    const initialView = cfg.initialView && typeof cfg.initialView === "object"
        ? {
            center: cfg.initialView.center && typeof cfg.initialView.center === "object"
                ? {
                    lat: Number(cfg.initialView.center.lat),
                    lng: Number(cfg.initialView.center.lng)
                }
                : null,
            zoom: Number(cfg.initialView.zoom)
        }
        : null;
    const allLocations = Array.isArray(cfg.locations) && cfg.locations.length > 0
        ? cfg.locations.map((loc, i) => ({
            ...loc,
            id: loc.id || `loc-${i}`,
            season: String(loc.season || "summer").toLowerCase()
        }))
        : fallbackLocations;

    let activeSeason = "summer";
    let map = null;
    let infoWindow = null;
    let markers = [];
    let visibleLocations = [];
    let activeId = "";
    let cameraAnimTimer = null;
    let isFullscreenMap = false;
    let routeGlow = null;
    let routeLine = null;
    let routeFlow = null;
    let routeAnimationFrame = null;
    const minAllowedZoom = 7;

    const mapStyle = [
        { elementType: "geometry", stylers: [{ color: "#e8edf3" }] },
        { elementType: "labels.text.fill", stylers: [{ color: "#6f7b88" }] },
        { elementType: "labels.text.stroke", stylers: [{ color: "#f1f5f9" }] },
        { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#d6dee8" }] },
        { featureType: "poi", stylers: [{ visibility: "off" }] },
        { featureType: "road", elementType: "geometry", stylers: [{ color: "#dfe5ee" }] },
        { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#d5dde8" }] },
        { featureType: "transit", stylers: [{ visibility: "off" }] },
        { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9d6ea" }] }
    ];

    const getVisibleLocations = () => {
        if (!hasFilters) {
            return allLocations;
        }
        return allLocations.filter((loc) => {
            return loc.season === "always" || loc.season === activeSeason;
        });
    };

    const updateFilterButtons = () => {
        if (!hasFilters) {
            return;
        }
        filterButtons.forEach((btn) => {
            const isActive = btn.getAttribute("data-season-filter") === activeSeason;
            btn.classList.toggle("active", isActive);
        });
    };

    const renderList = () => {
        if (!hasList) {
            return;
        }
        list.innerHTML = visibleLocations.map((loc, i) => `
            <button class="mapa-item${loc.id === activeId ? " active" : ""}" type="button" data-map-id="${loc.id}">
                <span class="mapa-item-title">${loc.title || `Miesto ${i + 1}`}</span>
                <span class="mapa-item-desc">${loc.description || ""}</span>
            </button>
        `).join("");
    };

    const setActiveCard = (id) => {
        if (!hasList) {
            return;
        }
        const cards = Array.from(list.querySelectorAll(".mapa-item"));
        cards.forEach((card) => {
            card.classList.toggle("active", card.getAttribute("data-map-id") === id);
        });
    };

    const isMobileLayout = () => window.matchMedia("(max-width: 960px)").matches;

    const closeInfoPanelSmooth = () => {
        if (!infoWindow) {
            return;
        }
        const panel = document.querySelector(".gm-style .gm-style-iw-c");
        if (!panel) {
            infoWindow.close();
            return;
        }
        panel.classList.add("map-iw-closing");
        window.setTimeout(() => {
            infoWindow.close();
            panel.classList.remove("map-iw-closing");
        }, 170);
    };

    const focusMainLocation = () => {
        const mainLoc = visibleLocations.find((loc) => loc.season === "always") || visibleLocations[0];
        if (!mainLoc || !map) {
            return;
        }
        const position = { lat: Number(mainLoc.lat), lng: Number(mainLoc.lng) };
        activeId = mainLoc.id;
        setActiveCard(mainLoc.id);
        map.panTo(position);
        map.setZoom(12);
        if (infoWindow) {
            infoWindow.close();
        }
    };

    const focusInitialView = () => {
        if (
            !map ||
            !initialView ||
            !initialView.center ||
            !Number.isFinite(initialView.center.lat) ||
            !Number.isFinite(initialView.center.lng) ||
            !Number.isFinite(initialView.zoom)
        ) {
            return false;
        }

        const mainLoc = visibleLocations.find((loc) => loc.season === "always") || visibleLocations[0];
        if (mainLoc) {
            activeId = mainLoc.id;
            setActiveCard(mainLoc.id);
        }

        map.setCenter(initialView.center);
        map.setZoom(initialView.zoom);
        if (infoWindow) {
            infoWindow.close();
        }
        return true;
    };

    const focusSeasonOverview = () => {
        if (!map || visibleLocations.length === 0) {
            return;
        }
        const bounds = new google.maps.LatLngBounds();
        visibleLocations.forEach((loc) => {
            bounds.extend({ lat: Number(loc.lat), lng: Number(loc.lng) });
        });
        map.fitBounds(bounds, 90);
        google.maps.event.addListenerOnce(map, "idle", () => {
            if ((map.getZoom() || minAllowedZoom) < minAllowedZoom) {
                map.setZoom(minAllowedZoom);
            }
        });
        if (infoWindow) {
            infoWindow.close();
        }
    };

    const stopRouteAnimation = () => {
        if (routeAnimationFrame !== null) {
            window.cancelAnimationFrame(routeAnimationFrame);
            routeAnimationFrame = null;
        }
    };

    const createSmoothRoutePath = (points) => {
        if (points.length < 3) {
            return points;
        }

        let smoothed = [...points];
        const passes = 5;

        for (let pass = 0; pass < passes; pass += 1) {
            const refined = [smoothed[0]];

            for (let i = 0; i < smoothed.length - 1; i += 1) {
                const current = smoothed[i];
                const next = smoothed[i + 1];

                refined.push({
                    lat: (0.75 * current.lat) + (0.25 * next.lat),
                    lng: (0.75 * current.lng) + (0.25 * next.lng)
                });

                refined.push({
                    lat: (0.25 * current.lat) + (0.75 * next.lat),
                    lng: (0.25 * current.lng) + (0.75 * next.lng)
                });
            }

            refined.push(smoothed[smoothed.length - 1]);
            smoothed = refined;
        }

        return smoothed;
    };

    const clearRouteOverlay = () => {
        stopRouteAnimation();
        [routeGlow, routeLine, routeFlow].forEach((polyline) => {
            if (polyline) {
                polyline.setMap(null);
            }
        });
        routeGlow = null;
        routeLine = null;
        routeFlow = null;
    };

    const createRouteOverlay = () => {
        if (!map || !window.google || routePath.length < 2) {
            return;
        }

        clearRouteOverlay();
        const smoothRoutePath = createSmoothRoutePath(routePath);

        routeGlow = new google.maps.Polyline({
            path: smoothRoutePath,
            geodesic: false,
            strokeColor: "#8b6934",
            strokeOpacity: 0.38,
            strokeWeight: 12,
            zIndex: 1
        });

        routeLine = new google.maps.Polyline({
            path: smoothRoutePath,
            geodesic: false,
            strokeColor: "#f0c26a",
            strokeOpacity: 0.9,
            strokeWeight: 6,
            zIndex: 2
        });

        routeFlow = new google.maps.Polyline({
            path: smoothRoutePath,
            geodesic: false,
            strokeOpacity: 0,
            zIndex: 3,
            icons: [
                {
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 1,
                        strokeColor: "#9fe8ff",
                        strokeOpacity: 0.85,
                        strokeWeight: 2,
                        fillColor: "#59d3f5",
                        fillOpacity: 0.22
                    },
                    offset: "0%",
                    repeat: "0"
                },
                {
                    icon: {
                        path: "M 0 -11 L 9 8 Q 10 10 8 10 L -8 10 Q -10 10 -9 8 Z",
                        scale: 1.08,
                        strokeColor: "#f4fbff",
                        strokeOpacity: 0.95,
                        strokeWeight: 2.4,
                        fillColor: "#44c6e8",
                        fillOpacity: 1,
                        anchor: new google.maps.Point(0, 2)
                    },
                    offset: "0%",
                    repeat: "0"
                }
            ]
        });

        routeGlow.setMap(map);
        routeLine.setMap(map);
        routeFlow.setMap(map);

        let startTime = null;
        const animateRoute = (timestamp) => {
            if (!routeFlow) {
                routeAnimationFrame = null;
                return;
            }
            if (!startTime) {
                startTime = timestamp;
            }
            const elapsed = timestamp - startTime;
            const progressValue = (elapsed * 0.0018) % 100;
            const progress = progressValue.toFixed(2);
            const icons = routeFlow.get("icons");
            if (icons && icons[0] && icons[1]) {
                const pulseCycle = (elapsed % 900) / 900;
                const pulseEase = 1 - Math.pow(1 - pulseCycle, 2);
                const pulseScale = 1 + (pulseEase * 16);
                const fadeWindow = 5;
                const fadeIn = Math.min(1, progressValue / fadeWindow);
                const fadeOut = Math.min(1, (100 - progressValue) / fadeWindow);
                const routeFade = Math.min(fadeIn, fadeOut);
                const arrowStrokeOpacity = 0.95 * routeFade;
                const arrowFillOpacity = 1 * routeFade;
                const pulseStrokeOpacity = 0.85 * (1 - pulseCycle) * routeFade;
                const pulseFillOpacity = 0.22 * (1 - pulseCycle) * routeFade;

                icons[0].offset = `${progress}%`;
                icons[0].icon = {
                    ...icons[0].icon,
                    scale: pulseScale,
                    strokeOpacity: pulseStrokeOpacity,
                    fillOpacity: pulseFillOpacity
                };
                icons[1].offset = `${progress}%`;
                icons[1].icon = {
                    ...icons[1].icon,
                    strokeOpacity: arrowStrokeOpacity,
                    fillOpacity: arrowFillOpacity
                };
                routeFlow.set("icons", icons);
            }
            routeAnimationFrame = window.requestAnimationFrame(animateRoute);
        };

        routeAnimationFrame = window.requestAnimationFrame(animateRoute);
    };

    const toggleFullscreenMap = (forceState) => {
        isFullscreenMap = typeof forceState === "boolean" ? forceState : !isFullscreenMap;
        layout.classList.toggle("mapa-fullscreen", isFullscreenMap);
        document.body.classList.toggle("mapa-fullscreen-open", isFullscreenMap);
        fullscreenToggle.setAttribute("aria-pressed", isFullscreenMap ? "true" : "false");
        fullscreenToggle.setAttribute(
            "aria-label",
            isFullscreenMap ? "Vypnut mapu na celu obrazovku" : "Zapnut mapu na celu obrazovku"
        );
        fullscreenLabel.textContent = isFullscreenMap ? "Sp\u00E4\u0165" : "Cel\u00E1 mapa";
        window.setTimeout(() => {
            if (map && window.google && window.google.maps) {
                google.maps.event.trigger(map, "resize");
                if (activeId) {
                    const activeLoc = visibleLocations.find((loc) => loc.id === activeId);
                    if (activeLoc) {
                        map.panTo({ lat: Number(activeLoc.lat), lng: Number(activeLoc.lng) });
                    }
                }
            }
        }, 120);
    };

    const buildMarkerContent = (loc) => {
        const node = document.createElement("div");
        node.className = `map-pin${loc.season === "always" ? " always" : ""}`;

        if (loc.image) {
            const img = document.createElement("img");
            img.className = "map-pin-image";
            img.src = loc.image;
            img.alt = loc.title || "";
            node.appendChild(img);
        }

        return node;
    };

    let HtmlMapMarker = null;

    const clearMarkers = () => {
        markers.forEach((entry) => {
            entry.marker.setMap(null);
        });
        markers = [];
    };

    const placeMarkers = () => {
        if (!map || !window.google) {
            return;
        }

        if (!HtmlMapMarker) {
            HtmlMapMarker = class extends google.maps.OverlayView {
                constructor({ position, mapRef, content, onClick }) {
                    super();
                    this.position = position;
                    this.content = content;
                    this.onClick = onClick;
                    this.setMap(mapRef);
                }

                onAdd() {
                    const pane = this.getPanes()?.overlayMouseTarget;
                    if (!pane) {
                        return;
                    }
                    this.content.addEventListener("click", this.onClick);
                    pane.appendChild(this.content);
                }

                draw() {
                    const projection = this.getProjection();
                    if (!projection) {
                        return;
                    }
                    const pixel = projection.fromLatLngToDivPixel(this.position);
                    if (!pixel) {
                        return;
                    }
                    this.content.style.left = `${pixel.x}px`;
                    this.content.style.top = `${pixel.y}px`;
                }

                onRemove() {
                    this.content.removeEventListener("click", this.onClick);
                    if (this.content.parentElement) {
                        this.content.parentElement.removeChild(this.content);
                    }
                }

                getPosition() {
                    return this.position;
                }
            };
        }

        clearMarkers();
        const bounds = new google.maps.LatLngBounds();
        visibleLocations.forEach((loc, index) => {
            const position = { lat: Number(loc.lat), lng: Number(loc.lng) };
            const latLng = new google.maps.LatLng(position.lat, position.lng);
            const marker = new HtmlMapMarker({
                position: latLng,
                mapRef: map,
                content: buildMarkerContent(loc),
                onClick: () => activateLocation(loc.id)
            });

            markers.push({ id: loc.id, marker, position: latLng });
            bounds.extend(position);
        });

        if (initialView && initialView.center && Number.isFinite(initialView.zoom)) {
            return;
        }

        if (visibleLocations.length > 1) {
            map.fitBounds(bounds, 70);
            google.maps.event.addListenerOnce(map, "idle", () => {
                if ((map.getZoom() || 0) > 13) {
                    map.setZoom(13);
                }
            });
        } else if (visibleLocations[0]) {
            map.setCenter({ lat: Number(visibleLocations[0].lat), lng: Number(visibleLocations[0].lng) });
            map.setZoom(13);
        }
    };

    const openLocation = (id) => {
        if (!map) {
            return;
        }
        const loc = visibleLocations.find((item) => item.id === id);
        const markerEntry = markers.find((item) => item.id === id);
        if (!loc || !markerEntry) {
            return;
        }

        activeId = id;
        setActiveCard(id);

        const markerPosition = markerEntry.position || markerEntry.marker.getPosition();
        if (typeof window.openMapLightbox === "function" && (loc.lightboxSrc || loc.lightboxText)) {
            window.openMapLightbox({
                src: loc.lightboxSrc || loc.image || "",
                alt: loc.title || "Miesto",
                title: loc.title || "Miesto",
                description: Object.prototype.hasOwnProperty.call(loc, "lightboxText")
                    ? (loc.lightboxText || "")
                    : (loc.description || ""),
                navigationUrl: loc.navigationUrl || loc.url || "",
                driveNavigationUrl: loc.driveNavigationUrl || "",
                walkNavigationUrl: loc.walkNavigationUrl || "",
                driveLabel: loc.driveLabel || (loc.walkNavigationUrl ? "Autom" : "Trasa"),
                walkLabel: loc.walkLabel || "Pešo"
            });
            return;
        }

        if (!preserveCameraOnMarkerOpen) {
            if (cameraAnimTimer) {
                window.clearInterval(cameraAnimTimer);
                cameraAnimTimer = null;
            }

            map.panTo(markerPosition);
            const targetZoom = 12;
            const startZoom = map.getZoom() || targetZoom;
            const zoomDirection = startZoom < targetZoom ? 1 : -1;

            if (startZoom !== targetZoom) {
                cameraAnimTimer = window.setInterval(() => {
                    const current = map.getZoom() || targetZoom;
                    if ((zoomDirection > 0 && current >= targetZoom) || (zoomDirection < 0 && current <= targetZoom)) {
                        map.setZoom(targetZoom);
                        window.clearInterval(cameraAnimTimer);
                        cameraAnimTimer = null;
                        return;
                    }
                    map.setZoom(current + zoomDirection);
                }, 70);
            }
        }

        const imageBlock = loc.image
            ? `<img class="map-balloon-image" src="${loc.image}" alt="${loc.title || "Miesto"}" />`
            : "";
        window.setTimeout(() => {
            infoWindow.setContent(`
                <div class="map-balloon">
                    ${imageBlock}
                    <h3>${loc.title || "Miesto"}</h3>
                    <p>${loc.description || ""}</p>
                    <a href="${loc.url || "#"}" target="_blank" rel="noopener noreferrer">Trasa</a>
                </div>
            `);
            infoWindow.setPosition(markerPosition);
            infoWindow.open({ map });
        }, 180);
    };

    const activateLocation = (id) => {
        const loc = visibleLocations.find((item) => item.id === id);
        if (!loc) {
            return;
        }

        const isMainLocation = loc.season === "always";
        if (preserveCameraOnMarkerOpen) {
            openLocation(id);
            return;
        }

        if (isMobileLayout() && !isFullscreenMap) {
            toggleFullscreenMap(true);
        }

        if (isMobileLayout() && isMainLocation) {
            focusMainLocation();
            return;
        }

        openLocation(id);
    };

    if (hasList) {
        list.addEventListener("click", (event) => {
            const btn = event.target instanceof Element ? event.target.closest("[data-map-id]") : null;
            if (!btn) {
                return;
            }
            const id = String(btn.getAttribute("data-map-id"));
            activateLocation(id);
        });
    }

    fullscreenToggle.addEventListener("click", () => {
        toggleFullscreenMap();
    });

    zoomInButton.addEventListener("click", () => {
        if (!map) {
            return;
        }
        map.setZoom((map.getZoom() || 12) + 1);
    });

    zoomOutButton.addEventListener("click", () => {
        if (!map) {
            return;
        }
        map.setZoom((map.getZoom() || 12) - 1);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && isFullscreenMap) {
            toggleFullscreenMap(false);
        }
    });

    filterButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const season = String(btn.getAttribute("data-season-filter") || "");
            if (!season || season === activeSeason) {
                return;
            }
            activeSeason = season;
            updateFilterButtons();
            visibleLocations = getVisibleLocations();
            renderList();
            placeMarkers();
            if (isFullscreenMap) {
                focusSeasonOverview();
            } else {
                focusMainLocation();
            }
        });
    });

    const initMap = () => {
        if (!window.google || !window.google.maps || allLocations.length === 0) {
            return;
        }

        const first = allLocations[0];
        map = new google.maps.Map(mapCanvas, {
            center: { lat: Number(first.lat), lng: Number(first.lng) },
            zoom: 12,
            minZoom: minAllowedZoom,
            mapTypeId,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            disableDefaultUI: true,
            zoomControl: false,
            clickableIcons: false,
            gestureHandling: isMobileLayout() ? "greedy" : "cooperative",
            scrollwheel: !isMobileLayout(),
            ...(mapTypeId === "roadmap" ? { styles: mapStyle } : {}),
            ...(mapId ? { mapId } : {})
        });

        map.addListener("click", () => {
            closeInfoPanelSmooth();
        });

        infoWindow = new google.maps.InfoWindow();
        visibleLocations = getVisibleLocations();
        placeMarkers();
        createRouteOverlay();
        status.hidden = true;
        if (!focusInitialView()) {
            focusMainLocation();
        }
    };

    updateFilterButtons();
    visibleLocations = getVisibleLocations();
    renderList();

    if (!apiKey) {
        status.hidden = false;
        status.textContent = "Doplnte spravny Google Maps API kluc v mapa.html.";
        return;
    }

    window.gm_authFailure = () => {
        status.hidden = false;
        status.textContent = "Google Maps key nema povoleny tento web v Website restrictions.";
    };

    if (window.google && window.google.maps) {
        initMap();
        return;
    }

    window.initMapaPage = initMap;
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=initMapaPage&loading=async&libraries=marker`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
        status.hidden = false;
        status.textContent = "Mapa sa nepodarilo nacitat. Skontrolujte API key, Website restrictions a Maps JavaScript API.";
    };
    document.head.appendChild(script);
})();
