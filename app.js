// --- Config ---
const WORK_START = 8; // 08:00
const WORK_END = 18; // 18:00
const SLOT_MIN = 30; // 30-min slots
const TEMP_HOLD_DURATION = 3 * 60 * 60 * 1000; // 3 hours in milliseconds
const STORAGE_KEY = 'plumberDemoState_v5'; // Updated version for timer feature

// Dutch labels for slot statuses
const STATUS_LABELS = {
    FREE: 'Vrij',
    TEMP: 'Tijdelijk vastgehouden',
    BOOKED: 'Geboekt',
    UNAVAILABLE: 'Niet beschikbaar',
    // Appointment statuses
    CONFIRMED: 'Bevestigd',
    REJECTED: 'Afgewezen',
    CANCELLED: 'Geannuleerd',
    EXPIRED: 'Verlopen',
    EXPIRED_UNAVAILABLE: 'Verlopen - Niet beschikbaar'
};

// Demo companies
const COMPANIES = [
    { id: 'C1', name: 'Loodgietersbedrijf Utrecht', color: '#22c55e' },
    { id: 'C2', name: 'Loodgietersbedrijf AM', color: '#3b82f6' }
];

// Demo services catalog
const SERVICES = [
    {
        id: 'S1',
        name: 'Verstopping / Afvoer',
        type: 'EASY',
        durationSlots: 2, // 60m
        base: 95,
        questions: [
            {
                key: 'location',
                label: 'Locatie',
                type: 'select',
                options: ['Keuken', 'Badkamer', 'Toilet']
            },
            {
                key: 'severity',
                label: 'Ernst',
                type: 'select',
                options: ['Langzaam afvoeren', 'Volledig verstopt']
            },
            { key: 'afterHours', label: 'Buiten kantooruren?', type: 'boolean' }
        ],
        price: (ans) => {
            let p = 95; // base
            if (ans.severity === 'Volledig verstopt') p += 40;
            if (ans.location === 'Toilet') p += 20;
            if (ans.afterHours === true) p += 60;
            return p;
        }
    },
    {
        id: 'S2',
        name: 'Badkamer Renovatie (Offerte)',
        type: 'COMPLEX',
        durationSlots: 4, // 2h site visit slot (demo)
        base: 0,
        questions: [
            { key: 'area', label: 'Geschatte badkamergrootte (m²)', type: 'number' },
            { key: 'shower', label: 'Douche?', type: 'boolean' },
            { key: 'bathtub', label: 'Ligbad?', type: 'boolean' }
        ],
        price: (ans) => null // quotation
    }
];

// --- Utility time helpers ---
function formatDateKey(d) {
    const y = d.getFullYear();
    const m = ('0' + (d.getMonth() + 1)).slice(-2);
    const day = ('0' + d.getDate()).slice(-2);
    return `${y}-${m}-${day}`;
}
function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}

// Get Dutch label for slot status
function getStatusLabel(status) {
    return STATUS_LABELS[status] || status;
}

function minutesToHHMM(min) {
    const h = Math.floor(min / 60),
        m = min % 60;
    return `${('' + h).padStart(2, '0')}:${('' + m).padStart(2, '0')}`;
}
function hhmmToMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

// Timer utility functions
function formatTimeRemaining(milliseconds) {
    if (milliseconds <= 0) return 'Verlopen';

    const hours = Math.floor(milliseconds / (60 * 60 * 1000));
    const minutes = Math.floor((milliseconds % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((milliseconds % (60 * 1000)) / 1000);

    if (hours > 0) {
        return `${hours}u ${minutes}m over`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds}s over`;
    } else {
        return `${seconds}s over`;
    }
}

function isAppointmentExpired(appt) {
    return appt.status === 'TEMP' && appt.expiresAt && Date.now() > appt.expiresAt;
}

function getTimeRemainingForAppointment(appt) {
    if (appt.status !== 'TEMP' || !appt.expiresAt) return null;
    return Math.max(0, appt.expiresAt - Date.now());
}

// Clean up expired temporary appointments
function cleanupExpiredAppointments() {
    let hasExpired = false;

    for (const apptId in state.appts) {
        const appt = state.appts[apptId];
        if (isAppointmentExpired(appt)) {
            // Free up the slots
            const slots = state.schedule[appt.companyId][appt.dateKey];
            for (let i = appt.startIdx; i < appt.endIdx; i++) {
                if (slots[i] === 'TEMP') {
                    slots[i] = 'FREE';
                }
            }

            // Mark appointment as expired
            appt.status = 'EXPIRED';
            hasExpired = true;

            // Send expiry notification email
            const subj = `Uw tijdelijke reservering is verlopen`;
            const body = `<p>Helaas is uw tijdelijke afspraakregistratie verlopen.</p>
<p><strong>Bedrijf:</strong> ${appt.companyName}<br/>
<strong>Datum:</strong> ${appt.dateKey}<br/>
<strong>Tijd:</strong> ${minutesToHHMM(appt.startIdx * SLOT_MIN + WORK_START * 60)}–${minutesToHHMM(
                appt.endIdx * SLOT_MIN + WORK_START * 60
            )}</p>
<p>De tijdslots zijn nu beschikbaar voor andere boekingen. Maak alstublieft een nieuw verzoek aan als u wilt omboeken.</p>`;
            pushEmail({ subj, body, apptId: null, to: appt.email || 'klant@voorbeeld.nl' });
        }
    }

    if (hasExpired) {
        renderDay();
        renderMonth();
        renderSidebarMonth();
        refreshMultiCalendarIfActive();
        saveState();
    }
}

// --- State ---
const state = {
    monthCursor: new Date(),
    selectedDate: new Date(),
    selectedCompanyId: 'C1', // Default to first company
    schedule: {}, // companyId -> dateKey -> ['FREE'|'TEMP'|'BOOKED'|'UNAVAILABLE']
    emails: [], // {id, subj, body, apptId, status, to}
    appts: {}, // apptId -> {companyId,dateKey,startIdx,endIdx,status,expiresAt}
    requests: [], // array of request objects (client → admin)
    nextApptId: 1,
    nextEmailId: 1,
    nextRequestId: 1,
    currentPage: 'admin',
    clientSelection: { serviceId: null, dateKey: null, startIdx: null, endIdx: null },
    timerInterval: null // For periodic cleanup of expired appointments
};

// --- Persistence ---
function saveState() {
    const data = {
        monthCursor: state.monthCursor.toISOString(),
        selectedDate: state.selectedDate.toISOString(),
        selectedCompanyId: state.selectedCompanyId,
        schedule: state.schedule,
        emails: state.emails,
        appts: state.appts,
        requests: state.requests,
        nextApptId: state.nextApptId,
        nextEmailId: state.nextEmailId,
        nextRequestId: state.nextRequestId
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    try {
        const data = JSON.parse(raw);
        if (data.monthCursor) state.monthCursor = new Date(data.monthCursor);
        if (data.selectedDate) state.selectedDate = new Date(data.selectedDate);
        state.selectedCompanyId = data.selectedCompanyId || 'C1';
        Object.assign(state.schedule, data.schedule || {});
        state.emails = data.emails || [];
        state.appts = data.appts || {};
        state.requests = data.requests || [];
        state.nextApptId = data.nextApptId || 1;
        state.nextEmailId = data.nextEmailId || 1;
        state.nextRequestId = data.nextRequestId || 1;

        // Initialize company schedules if they don't exist
        COMPANIES.forEach((company) => {
            if (!state.schedule[company.id]) {
                state.schedule[company.id] = {};
            }
        });

        return true;
    } catch (e) {
        console.warn('Failed to load saved state', e);
        return false;
    }
}

// Initialize default day slots as FREE for a specific company
function ensureDay(dateKey, companyId = null) {
    const cId = companyId || state.selectedCompanyId;
    if (!state.schedule[cId]) {
        state.schedule[cId] = {};
    }
    if (!state.schedule[cId][dateKey]) {
        const slots = [];
        const total = ((WORK_END - WORK_START) * 60) / SLOT_MIN;
        for (let i = 0; i < total; i++) slots.push('FREE');
        state.schedule[cId][dateKey] = slots;
    }
}

// Get combined slots from all companies for client view
function getCombinedSlots(dateKey) {
    const combined = [];
    const total = ((WORK_END - WORK_START) * 60) / SLOT_MIN;

    for (let i = 0; i < total; i++) {
        let hasAnyFree = false;
        for (const company of COMPANIES) {
            ensureDay(dateKey, company.id);
            if (state.schedule[company.id][dateKey][i] === 'FREE') {
                hasAnyFree = true;
                break;
            }
        }
        combined.push(hasAnyFree ? 'FREE' : 'OCCUPIED');
    }
    return combined;
}

// --- Month calendar rendering (Admin) ---
function renderMonth() {
    const wrap = document.getElementById('month');
    if (!wrap) return;
    wrap.innerHTML = '';
    const d = new Date(state.monthCursor.getFullYear(), state.monthCursor.getMonth(), 1);
    const year = d.getFullYear();
    const month = d.getMonth();
    const monthName = d.toLocaleString(undefined, { month: 'long', year: 'numeric' });

    const header = document.createElement('header');
    const prev = document.createElement('button');
    prev.textContent = '‹ Vorige';
    prev.onclick = () => {
        state.monthCursor = new Date(year, month - 1, 1);
        renderMonth();
        saveState();
    };
    const next = document.createElement('button');
    next.textContent = 'Volgende ›';
    next.onclick = () => {
        state.monthCursor = new Date(year, month + 1, 1);
        renderMonth();
        saveState();
    };
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = monthName;
    header.append(prev, title, next);

    const dow = document.createElement('div');
    dow.className = 'dow';
    ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].forEach((d) => {
        const el = document.createElement('div');
        el.textContent = d;
        dow.appendChild(el);
    });

    const days = document.createElement('div');
    days.className = 'days';
    const firstDow = (d.getDay() + 6) % 7; // Monday=0
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDow; i++) {
        const dd = new Date(year, month, -firstDow + i + 1);
        days.appendChild(dayCell(dd, true));
    }
    for (let i = 1; i <= daysInMonth; i++) {
        const dd = new Date(year, month, i);
        days.appendChild(dayCell(dd, false));
    }
    const totalCells = firstDow + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= trailing; i++) {
        const dd = new Date(year, month + 1, i);
        days.appendChild(dayCell(dd, true));
    }

    wrap.append(header, dow, days);
}

function dayCell(date, isOut) {
    const dateKey = formatDateKey(date);
    ensureDay(dateKey);
    const cell = document.createElement('div');
    cell.className = 'day' + (isOut ? ' out' : '');
    if (formatDateKey(state.selectedDate) === dateKey) cell.style.outline = '2px solid var(--blue)';
    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = date.getDate();
    const dots = document.createElement('div');
    dots.className = 'dots';
    const slots = state.schedule[state.selectedCompanyId][dateKey];
    const hasBooked = slots.includes('BOOKED');
    const hasTemp = slots.includes('TEMP');
    const hasUnavailable = slots.includes('UNAVAILABLE');
    const hasFree = slots.includes('FREE');

    if (hasBooked) {
        const el = document.createElement('div');
        el.className = 'dot';
        el.style.background = 'var(--red)';
        dots.appendChild(el);
    }
    if (hasTemp) {
        const el = document.createElement('div');
        el.className = 'dot';
        el.style.background = 'var(--gray)';
        dots.appendChild(el);
    }
    if (hasUnavailable) {
        const el = document.createElement('div');
        el.className = 'dot';
        el.style.background = 'var(--yellow)';
        dots.appendChild(el);
    }
    if (hasFree && !hasBooked && !hasTemp && !hasUnavailable) {
        const el = document.createElement('div');
        el.className = 'dot';
        el.style.background = 'var(--green)';
        dots.appendChild(el);
    }

    cell.append(num, dots);
    cell.onclick = () => {
        state.selectedDate = new Date(date);
        syncDatePicker();
        renderMonth();
        renderDay();
        saveState();
    };
    return cell;
}

function renderDay() {
    const container = document.getElementById('slots');
    if (!container) return;
    container.innerHTML = '';
    const dateKey = formatDateKey(state.selectedDate);
    ensureDay(dateKey);
    const slots = state.schedule[state.selectedCompanyId][dateKey];
    const startMin = WORK_START * 60;
    const total = slots.length;

    for (let i = 0; i < total; i++) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'trow';

        const timeDiv = document.createElement('div');
        timeDiv.className = 'time';
        const slotMin = startMin + i * SLOT_MIN;
        const slotEndMin = slotMin + SLOT_MIN;
        timeDiv.textContent = `${minutesToHHMM(slotMin)}-${minutesToHHMM(slotEndMin)}`;

        const slotDiv = document.createElement('div');
        slotDiv.className = `slot ${slots[i]}`;

        // Find appointment info for this slot
        const apptInfo = findAppointmentInfo(dateKey, i);
        let displayText = getStatusLabel(slots[i]);

        if (slots[i] === 'BOOKED' || slots[i] === 'TEMP') {
            let customerName = 'Unknown';
            let email = '';
            let shouldShowActions = false;
            let timerInfo = '';

            if (apptInfo && apptInfo.type === 'appointment') {
                customerName =
                    apptInfo.data.customerName ||
                    (apptInfo.data.client ? apptInfo.data.client.name : 'Unknown') ||
                    'Unknown';
                email = apptInfo.data.email || '';
                shouldShowActions = true;

                // Add timer for TEMP appointments
                if (slots[i] === 'TEMP' && apptInfo.data.expiresAt) {
                    const remaining = getTimeRemainingForAppointment(apptInfo.data);
                    if (remaining !== null) {
                        timerInfo = ` (⏰ ${formatTimeRemaining(remaining)})`;
                    }
                }
            } else if (apptInfo && apptInfo.type === 'request') {
                customerName =
                    apptInfo.data.customer.name ||
                    (apptInfo.data.client ? apptInfo.data.client.name : 'Unknown') ||
                    'Unknown';
                email = apptInfo.data.customer.email || '';
                shouldShowActions = true;
            }

            displayText = `${getStatusLabel(slots[i])} - ${customerName}${timerInfo}`;

            if (shouldShowActions) {
                // Add action buttons for booked/temp slots
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'slot-actions';
                actionsDiv.style.cssText = 'display: flex; gap: 4px; margin-left: auto;';

                // WhatsApp button
                const whatsappBtn = document.createElement('button');
                whatsappBtn.innerHTML =
                    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 258"><defs><linearGradient id="whatsappGrad1" x1="50%" x2="50%" y1="100%" y2="0%"><stop offset="0%" stop-color="#1faf38"/><stop offset="100%" stop-color="#60d669"/></linearGradient><linearGradient id="whatsappGrad2" x1="50%" x2="50%" y1="100%" y2="0%"><stop offset="0%" stop-color="#f9f9f9"/><stop offset="100%" stop-color="#fff"/></linearGradient></defs><path fill="url(#whatsappGrad1)" d="M5.463 127.456c-.006 21.677 5.658 42.843 16.428 61.499L4.433 252.697l65.232-17.104a123 123 0 0 0 58.8 14.97h.054c67.815 0 123.018-55.183 123.047-123.01c.013-32.867-12.775-63.773-36.009-87.025c-23.23-23.25-54.125-36.061-87.043-36.076c-67.823 0-123.022 55.18-123.05 123.004"/><path fill="url(#whatsappGrad2)" d="M1.07 127.416c-.007 22.457 5.86 44.38 17.014 63.704L0 257.147l67.571-17.717c18.618 10.151 39.58 15.503 60.91 15.511h.055c70.248 0 127.434-57.168 127.464-127.423c.012-34.048-13.236-66.065-37.3-90.15C194.633 13.286 162.633.014 128.536 0C58.276 0 1.099 57.16 1.071 127.416m40.24 60.376l-2.523-4.005c-10.606-16.864-16.204-36.352-16.196-56.363C22.614 69.029 70.138 21.52 128.576 21.52c28.3.012 54.896 11.044 74.9 31.06c20.003 20.018 31.01 46.628 31.003 74.93c-.026 58.395-47.551 105.91-105.943 105.91h-.042c-19.013-.01-37.66-5.116-53.922-14.765l-3.87-2.295l-40.098 10.513z"/><path fill="#fff" d="M96.678 74.148c-2.386-5.303-4.897-5.41-7.166-5.503c-1.858-.08-3.982-.074-6.104-.074c-2.124 0-5.575.799-8.492 3.984c-2.92 3.188-11.148 10.892-11.148 26.561s11.413 30.813 13.004 32.94c1.593 2.123 22.033 35.307 54.405 48.073c26.904 10.609 32.379 8.499 38.218 7.967c5.84-.53 18.844-7.702 21.497-15.139c2.655-7.436 2.655-13.81 1.859-15.142c-.796-1.327-2.92-2.124-6.105-3.716s-18.844-9.298-21.763-10.361c-2.92-1.062-5.043-1.592-7.167 1.597c-2.124 3.184-8.223 10.356-10.082 12.48c-1.857 2.129-3.716 2.394-6.9.801c-3.187-1.598-13.444-4.957-25.613-15.806c-9.468-8.442-15.86-18.867-17.718-22.056c-1.858-3.184-.199-4.91 1.398-6.497c1.431-1.427 3.186-3.719 4.78-5.578c1.588-1.86 2.118-3.187 3.18-5.311c1.063-2.126.531-3.986-.264-5.579c-.798-1.593-6.987-17.343-9.819-23.64"/></svg>';
                whatsappBtn.title = 'WhatsApp';
                whatsappBtn.className = 'action-btn';
                whatsappBtn.onclick = (e) => {
                    e.stopPropagation();
                    const phone = prompt(`Enter phone number for ${customerName}:`);
                    if (phone) {
                        const message = encodeURIComponent(
                            `Hi ${customerName}, regarding your appointment on ${dateKey} at ${minutesToHHMM(
                                slotMin
                            )}`
                        );
                        window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
                    }
                };

                // Email button
                const emailBtn = document.createElement('button');
                emailBtn.innerHTML =
                    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 32 32"><path fill="#42a5f5" d="M28 6H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2m0 6l-12 6l-12-6V8l12 6l12-6Z"/></svg>';
                emailBtn.title = 'Email';
                emailBtn.className = 'action-btn';
                emailBtn.onclick = (e) => {
                    e.stopPropagation();
                    const subject = encodeURIComponent(`Appointment Reminder - ${dateKey}`);
                    const body = encodeURIComponent(`Hi ${customerName},

This is a reminder about your appointment on ${dateKey} at ${minutesToHHMM(slotMin)}.

Best regards,
Plumber Service`);
                    window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank');
                };

                actionsDiv.appendChild(whatsappBtn);
                actionsDiv.appendChild(emailBtn);

                slotDiv.innerHTML = displayText;
                slotDiv.appendChild(actionsDiv);
                slotDiv.style.cssText =
                    'display: flex; align-items: center; justify-content: space-between;';
            } else {
                slotDiv.textContent = displayText;
            }
        } else {
            slotDiv.textContent = displayText;
        }

        slotDiv.onclick = () => showAppointmentPopup(dateKey, i, slots[i]);
        rowDiv.append(timeDiv, slotDiv);
        container.appendChild(rowDiv);
    }
}

// --- Controls: time selects & date picker (Admin) ---
function buildTimeOptions() {
    const startSel = document.getElementById('startTime');
    const endSel = document.getElementById('endTime');
    if (!startSel || !endSel) return;
    startSel.innerHTML = '';
    endSel.innerHTML = '';
    const startMin = WORK_START * 60;
    const total = ((WORK_END - WORK_START) * 60) / SLOT_MIN;
    for (let i = 0; i <= total; i++) {
        const t = minutesToHHMM(startMin + i * SLOT_MIN);
        const opt1 = document.createElement('option');
        opt1.value = t;
        opt1.textContent = t;
        startSel.appendChild(opt1);
        const opt2 = document.createElement('option');
        opt2.value = t;
        opt2.textContent = t;
        endSel.appendChild(opt2);
    }
    startSel.selectedIndex = 0;
    endSel.selectedIndex = 2; // 1 hour default
}

function syncDatePicker() {
    const dp = document.getElementById('datePicker');
    if (!dp) return;
    dp.value = formatDateKey(state.selectedDate);
}

// --- Helpers ---
function emailValid(v) {
    return typeof v === 'string' && v.includes('@') && v.includes('.');
}
function showClientError(msg) {
    const box = document.getElementById('c_error');
    if (!box) return;
    box.textContent = msg;
    box.classList.remove('hidden');
}
function clearClientError() {
    const box = document.getElementById('c_error');
    if (!box) return;
    box.textContent = '';
    box.classList.add('hidden');
}

// --- Popup for appointment details ---
function findAppointmentInfo(dateKey, slotIndex) {
    // Look for appointment covering the slot in the selected company
    // Include cancelled appointments for viewing details, but they don't block slots
    for (const apptId in state.appts) {
        const appt = state.appts[apptId];
        if (
            appt.companyId === state.selectedCompanyId &&
            appt.dateKey === dateKey &&
            slotIndex >= appt.startIdx &&
            slotIndex < appt.endIdx
        ) {
            return { type: 'appointment', data: appt, apptId };
        }
    }
    // Look for request hold covering the slot in the selected company
    for (const req of state.requests) {
        if (
            req.hold &&
            req.hold.companyId === state.selectedCompanyId &&
            req.hold.dateKey === dateKey &&
            slotIndex >= req.hold.startIdx &&
            slotIndex < req.hold.endIdx
        ) {
            return { type: 'request', data: req };
        }
    }
    return null;
}

function showAppointmentPopup(dateKey, slotIndex, slotStatus) {
    const info = findAppointmentInfo(dateKey, slotIndex);
    let title, content;
    if (info?.type === 'appointment') {
        const appt = info.data;
        const startTime = minutesToHHMM(WORK_START * 60 + appt.startIdx * SLOT_MIN);
        const endTime = minutesToHHMM(WORK_START * 60 + appt.endIdx * SLOT_MIN);
        const customerName = appt.customerName || (appt.client ? appt.client.name : 'Unknown');
        const email = appt.email || (appt.client ? appt.client.email : 'No email');

        title = `Appointment #${info.apptId}`;

        // Add timer info for TEMP appointments
        let timerDisplay = '';
        if (appt.status === 'TEMP' && appt.expiresAt) {
            const remaining = getTimeRemainingForAppointment(appt);
            if (remaining !== null) {
                const isExpired = remaining <= 0;
                timerDisplay = `
      <div class="popup-row">
        <span class="popup-label">Timer:</span>
        <span class="popup-value" style="color: ${
            isExpired ? 'var(--red)' : 'var(--yellow)'
        }; font-weight: 600;">
          ⏰ ${formatTimeRemaining(remaining)}
        </span>
      </div>`;
            }
        }

        content = `
      <div class="popup-row">
        <span class="popup-label">Status:</span>
        <span class="popup-value">${getStatusLabel(appt.status)}</span>
      </div>${timerDisplay}
      <div class="popup-row">
        <span class="popup-label">Bedrijf:</span>
        <span class="popup-value">${appt.companyName || 'Onbekend Bedrijf'}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Klant:</span>
        <span class="popup-value">${customerName}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">E-mail:</span>
        <span class="popup-value">${email}</span>
      </div>
      ${
          appt.serviceName
              ? `<div class="popup-row"><span class="popup-label">Service:</span><span class="popup-value">${appt.serviceName}</span></div>`
              : ''
      }
      <div class="popup-row">
        <span class="popup-label">Datum:</span>
        <span class="popup-value">${dateKey}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Tijd:</span>
        <span class="popup-value">${startTime} - ${endTime}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Duration:</span>
        <span class="popup-value">${(appt.endIdx - appt.startIdx) * SLOT_MIN} minutes</span>
      </div>
      <div style="margin-top: 16px; display: flex; gap: 8px;">
        ${
            appt.status !== 'CANCELLED'
                ? `
        <button class="btn" onclick="
          const phone = prompt('Enter phone number for ${customerName}:');
          if (phone) {
            const message = encodeURIComponent('Hallo ${customerName}, betreft uw afspraak op ${dateKey} om ${startTime}');
            window.open('https://wa.me/' + phone + '?text=' + message, '_blank');
          }
        ">&nbsp;<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 258"><defs><linearGradient id="whatsappGrad1" x1="50%" x2="50%" y1="100%" y2="0%"><stop offset="0%" stop-color="#1faf38"/><stop offset="100%" stop-color="#60d669"/></linearGradient><linearGradient id="whatsappGrad2" x1="50%" x2="50%" y1="100%" y2="0%"><stop offset="0%" stop-color="#f9f9f9"/><stop offset="100%" stop-color="#fff"/></linearGradient></defs><path fill="url(#whatsappGrad1)" d="M5.463 127.456c-.006 21.677 5.658 42.843 16.428 61.499L4.433 252.697l65.232-17.104a123 123 0 0 0 58.8 14.97h.054c67.815 0 123.018-55.183 123.047-123.01c.013-32.867-12.775-63.773-36.009-87.025c-23.23-23.25-54.125-36.061-87.043-36.076c-67.823 0-123.022 55.18-123.05 123.004"/><path fill="url(#whatsappGrad2)" d="M1.07 127.416c-.007 22.457 5.86 44.38 17.014 63.704L0 257.147l67.571-17.717c18.618 10.151 39.58 15.503 60.91 15.511h.055c70.248 0 127.434-57.168 127.464-127.423c.012-34.048-13.236-66.065-37.3-90.15C194.633 13.286 162.633.014 128.536 0C58.276 0 1.099 57.16 1.071 127.416m40.24 60.376l-2.523-4.005c-10.606-16.864-16.204-36.352-16.196-56.363C22.614 69.029 70.138 21.52 128.576 21.52c28.3.012 54.896 11.044 74.9 31.06c20.003 20.018 31.01 46.628 31.003 74.93c-.026 58.395-47.551 105.91-105.943 105.91h-.042c-19.013-.01-37.66-5.116-53.922-14.765l-3.87-2.295l-40.098 10.513z"/><path fill="#fff" d="M96.678 74.148c-2.386-5.303-4.897-5.41-7.166-5.503c-1.858-.08-3.982-.074-6.104-.074c-2.124 0-5.575.799-8.492 3.984c-2.92 3.188-11.148 10.892-11.148 26.561s11.413 30.813 13.004 32.94c1.593 2.123 22.033 35.307 54.405 48.073c26.904 10.609 32.379 8.499 38.218 7.967c5.84-.53 18.844-7.702 21.497-15.139c2.655-7.436 2.655-13.81 1.859-15.142c-.796-1.327-2.92-2.124-6.105-3.716s-18.844-9.298-21.763-10.361c-2.92-1.062-5.043-1.592-7.167 1.597c-2.124 3.184-8.223 10.356-10.082 12.48c-1.857 2.129-3.716 2.394-6.9.801c-3.187-1.598-13.444-4.957-25.613-15.806c-9.468-8.442-15.86-18.867-17.718-22.056c-1.858-3.184-.199-4.91 1.398-6.497c1.431-1.427 3.186-3.719 4.78-5.578c1.588-1.86 2.118-3.187 3.18-5.311c1.063-2.126.531-3.986-.264-5.579c-.798-1.593-6.987-17.343-9.819-23.64"/></svg> WhatsApp</button>
        <button class="btn" onclick="
          const subject = encodeURIComponent('Afspraak - ${dateKey}');
          const body = encodeURIComponent('Hallo ${customerName},\\n\\nBetreft uw afspraak op ${dateKey} om ${startTime}.\\n\\nMet vriendelijke groet,\\nLoodgieter Service');
          window.open('mailto:${email}?subject=' + subject + '&body=' + body, '_blank');
        ">&nbsp;<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 32 32"><path fill="#42a5f5" d="M28 6H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2m0 6l-12 6l-12-6V8l12 6l12-6Z"/></svg> Email</button>
        `
                : '<span style="color: var(--sub); font-style: italic;">Deze afspraak is geannuleerd</span>'
        }
        ${
            appt.status === 'CONFIRMED'
                ? `<button class="btn btn-cancel" onclick="cancelAppointment(${info.apptId})" title="Deze afspraak annuleren">🗑️ Annuleren</button>`
                : ''
        }
      </div>
    `;
    } else if (info?.type === 'request') {
        const req = info.data;
        const startTime = minutesToHHMM(WORK_START * 60 + req.hold.startIdx * SLOT_MIN);
        const endTime = minutesToHHMM(WORK_START * 60 + req.hold.endIdx * SLOT_MIN);

        title = `Client Request #${req.id}`;
        const holdCompany = COMPANIES.find((c) => c.id === req.hold?.companyId);
        content = `
      <div class="popup-row">
        <span class="popup-label">Client:</span>
        <span class="popup-value">${req.customer.name}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Email:</span>
        <span class="popup-value">${req.customer.email}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Service:</span>
        <span class="popup-value">${req.serviceName}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Status:</span>
        <span class="popup-value">${req.status}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Held by Company:</span>
        <span class="popup-value">${holdCompany ? holdCompany.name : 'Unknown Company'}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Date:</span>
        <span class="popup-value">${dateKey}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Time:</span>
        <span class="popup-value">${startTime} - ${endTime}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Estimate:</span>
        <span class="popup-value">${
            req.estimate != null ? '€' + req.estimate.toFixed(2) : 'Quotation'
        }</span>
      </div>
      <div style="margin-top: 16px; display: flex; gap: 8px;">
        <button class="btn" onclick="
          const phone = prompt('Enter phone number for ${req.customer.name}:');
          if (phone) {
            const message = encodeURIComponent('Hi ${
                req.customer.name
            }, regarding your service request for ${req.serviceName}');
            window.open('https://wa.me/' + phone + '?text=' + message, '_blank');
          }
        ">&nbsp;<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 258"><defs><linearGradient id="whatsappGrad1" x1="50%" x2="50%" y1="100%" y2="0%"><stop offset="0%" stop-color="#1faf38"/><stop offset="100%" stop-color="#60d669"/></linearGradient><linearGradient id="whatsappGrad2" x1="50%" x2="50%" y1="100%" y2="0%"><stop offset="0%" stop-color="#f9f9f9"/><stop offset="100%" stop-color="#fff"/></linearGradient></defs><path fill="url(#whatsappGrad1)" d="M5.463 127.456c-.006 21.677 5.658 42.843 16.428 61.499L4.433 252.697l65.232-17.104a123 123 0 0 0 58.8 14.97h.054c67.815 0 123.018-55.183 123.047-123.01c.013-32.867-12.775-63.773-36.009-87.025c-23.23-23.25-54.125-36.061-87.043-36.076c-67.823 0-123.022 55.18-123.05 123.004"/><path fill="url(#whatsappGrad2)" d="M1.07 127.416c-.007 22.457 5.86 44.38 17.014 63.704L0 257.147l67.571-17.717c18.618 10.151 39.58 15.503 60.91 15.511h.055c70.248 0 127.434-57.168 127.464-127.423c.012-34.048-13.236-66.065-37.3-90.15C194.633 13.286 162.633.014 128.536 0C58.276 0 1.099 57.16 1.071 127.416m40.24 60.376l-2.523-4.005c-10.606-16.864-16.204-36.352-16.196-56.363C22.614 69.029 70.138 21.52 128.576 21.52c28.3.012 54.896 11.044 74.9 31.06c20.003 20.018 31.01 46.628 31.003 74.93c-.026 58.395-47.551 105.91-105.943 105.91h-.042c-19.013-.01-37.66-5.116-53.922-14.765l-3.87-2.295l-40.098 10.513z"/><path fill="#fff" d="M96.678 74.148c-2.386-5.303-4.897-5.41-7.166-5.503c-1.858-.08-3.982-.074-6.104-.074c-2.124 0-5.575.799-8.492 3.984c-2.92 3.188-11.148 10.892-11.148 26.561s11.413 30.813 13.004 32.94c1.593 2.123 22.033 35.307 54.405 48.073c26.904 10.609 32.379 8.499 38.218 7.967c5.84-.53 18.844-7.702 21.497-15.139c2.655-7.436 2.655-13.81 1.859-15.142c-.796-1.327-2.92-2.124-6.105-3.716s-18.844-9.298-21.763-10.361c-2.92-1.062-5.043-1.592-7.167 1.597c-2.124 3.184-8.223 10.356-10.082 12.48c-1.857 2.129-3.716 2.394-6.9.801c-3.187-1.598-13.444-4.957-25.613-15.806c-9.468-8.442-15.86-18.867-17.718-22.056c-1.858-3.184-.199-4.91 1.398-6.497c1.431-1.427 3.186-3.719 4.78-5.578c1.588-1.86 2.118-3.187 3.18-5.311c1.063-2.126.531-3.986-.264-5.579c-.798-1.593-6.987-17.343-9.819-23.64"/></svg> WhatsApp</button>
        <button class="btn" onclick="
          const subject = encodeURIComponent('Serviceverzoek - ${req.serviceName}');
          const body = encodeURIComponent('Hallo ${
              req.customer.name
          },\\n\\nBetreft uw serviceverzoek voor ${
            req.serviceName
        }.\\n\\nMet vriendelijke groet,\\nLoodgieter Service');
          window.open('mailto:${
              req.customer.email
          }?subject=' + subject + '&body=' + body, '_blank');
        ">&nbsp;<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 32 32"><path fill="#42a5f5" d="M28 6H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2m0 6l-12 6l-12-6V8l12 6l12-6Z"/></svg> Email</button>
      </div>
    `;
    } else {
        // Handle FREE and UNAVAILABLE slots with toggle functionality
        if (slotStatus === 'FREE' || slotStatus === 'UNAVAILABLE') {
            const companyName =
                COMPANIES.find((c) => c.id === state.selectedCompanyId)?.name || 'Onbekend';
            const slotTime = minutesToHHMM(WORK_START * 60 + slotIndex * SLOT_MIN);
            const nextSlotTime = minutesToHHMM(WORK_START * 60 + (slotIndex + 1) * SLOT_MIN);
            const toggleTo = slotStatus === 'FREE' ? 'UNAVAILABLE' : 'FREE';
            const toggleLabel = toggleTo === 'FREE' ? 'Beschikbaar' : 'Niet beschikbaar';
            const actionEmoji = toggleTo === 'FREE' ? '✅' : '🚫';

            title = `${getStatusLabel(slotStatus)} Tijdslot - Status Wijzigen`;
            content = `
              <div class="popup-row">
                <span class="popup-label">Bedrijf:</span>
                <span class="popup-value">${companyName}</span>
              </div>
              <div class="popup-row">
                <span class="popup-label">Datum:</span>
                <span class="popup-value">${dateKey}</span>
              </div>
              <div class="popup-row">
                <span class="popup-label">Tijd:</span>
                <span class="popup-value">${slotTime} - ${nextSlotTime}</span>
              </div>
              <div class="popup-row">
                <span class="popup-label">Huidige Status:</span>
                <span class="popup-value" style="color: ${
                    slotStatus === 'FREE' ? 'var(--green)' : 'var(--yellow)'
                };">${getStatusLabel(slotStatus)}</span>
              </div>
              <div style="margin-top: 16px; padding: 16px; background: var(--muted); border-radius: 8px;">
                <p style="margin: 0 0 12px 0; color: var(--text); font-weight: 500;">
                  ${actionEmoji} Dit tijdslot wijzigen naar <strong>${toggleLabel}</strong>?
                </p>
                <div style="display: flex; gap: 8px; justify-content: center;">
                  <button class="btn primary" onclick="toggleSlotStatus('${dateKey}', ${slotIndex}, '${toggleTo}', this)">
                    ${actionEmoji} Instellen als ${toggleLabel}
                  </button>
                  <button class="btn secondary popup-close">Annuleren</button>
                </div>
              </div>
            `;
        } else {
            title = `${getStatusLabel(slotStatus)} Tijdslot`;
            content = `
              <div class="popup-row">
                <span class="popup-label">Datum:</span>
                <span class="popup-value">${dateKey}</span>
              </div>
              <div class="popup-row">
                <span class="popup-label">Time:</span>
                <span class="popup-value">${minutesToHHMM(
                    WORK_START * 60 + slotIndex * SLOT_MIN
                )}</span>
              </div>
              <div class="popup-row">
                <span class="popup-label">Status:</span>
                <span class="popup-value">${getStatusLabel(slotStatus)}</span>
              </div>
              <div class="popup-row">
                <span class="popup-label">Info:</span>
                <span class="popup-value">Geen afspraakgegevens gevonden</span>
              </div>
            `;
        }
    }

    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay';
    overlay.innerHTML = `
    <div class="popup">
      <button class="popup-close">×</button>
      <h3>${title}</h3>
      <div class="popup-info">
        ${content}
      </div>
    </div>
  `;

    document.body.appendChild(overlay);

    // Close popup handlers
    const closeBtn = overlay.querySelector('.popup-close');
    closeBtn.onclick = () => document.body.removeChild(overlay);
    overlay.onclick = (e) => {
        if (e.target === overlay) document.body.removeChild(overlay);
    };

    // Close on escape key
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            document.body.removeChild(overlay);
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
}

// Toggle slot status between FREE and UNAVAILABLE
function toggleSlotStatus(dateKey, slotIndex, newStatus, buttonElement) {
    const companyId = state.selectedCompanyId;
    const companyName = COMPANIES.find((c) => c.id === companyId)?.name || 'Unknown';
    const slotTime = minutesToHHMM(WORK_START * 60 + slotIndex * SLOT_MIN);
    const nextSlotTime = minutesToHHMM(WORK_START * 60 + (slotIndex + 1) * SLOT_MIN);

    // Show confirmation popup
    const confirmOverlay = document.createElement('div');
    confirmOverlay.className = 'popup-overlay';

    const statusColor = newStatus === 'FREE' ? 'var(--green)' : 'var(--yellow)';
    const statusIcon = newStatus === 'FREE' ? '✅' : '🚫';
    const actionDescription =
        newStatus === 'FREE'
            ? 'Dit tijdslot wordt beschikbaar voor boekingen.'
            : 'Dit tijdslot wordt geblokkeerd voor boekingen.';

    confirmOverlay.innerHTML = `
        <div class="popup confirmation-popup">
            <button class="popup-close">×</button>
            <h3>🔄 Confirm Status Change</h3>
            <div class="popup-info">
                <div class="confirmation-details">
                    <div class="popup-row">
                        <span class="popup-label">Company:</span>
                        <span class="popup-value">${companyName}</span>
                    </div>
                    <div class="popup-row">
                        <span class="popup-label">Date:</span>
                        <span class="popup-value">${dateKey}</span>
                    </div>
                    <div class="popup-row">
                        <span class="popup-label">Time:</span>
                        <span class="popup-value">${slotTime} - ${nextSlotTime}</span>
                    </div>
                    <div class="popup-row">
                        <span class="popup-label">New Status:</span>
                        <span class="popup-value" style="color: ${statusColor}; font-weight: 600;">
                            ${statusIcon} ${newStatus}
                        </span>
                    </div>
                </div>
                <div class="confirmation-message">
                    <p>${actionDescription}</p>
                </div>
                <div class="popup-actions">
                    <button class="btn primary" id="confirmToggle">
                        ${statusIcon} Confirm Change
                    </button>
                    <button class="btn secondary popup-close">Cancel</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(confirmOverlay);

    // Handle confirmation
    confirmOverlay.querySelector('#confirmToggle').onclick = () => {
        // Apply the status change
        ensureDay(dateKey, companyId);
        const slots = state.schedule[companyId][dateKey];
        slots[slotIndex] = newStatus;

        // Re-render everything
        renderDay();
        renderMonth();
        renderSidebarMonth();
        refreshMultiCalendarIfActive();
        saveState();

        // Close both popups
        confirmOverlay.remove();
        const originalPopup = document.querySelector('.popup-overlay');
        if (originalPopup) {
            originalPopup.remove();
        }

        // Show success message
        const successMessage =
            newStatus === 'FREE'
                ? 'Slot is now available for bookings'
                : 'Slot is now unavailable for bookings';

        // Create temporary success notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, var(--blue), #2563eb);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
            z-index: 10000;
            font-weight: 500;
            font-size: 14px;
        `;
        notification.textContent = `${statusIcon} ${successMessage}`;
        document.body.appendChild(notification);

        // Remove notification after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 3000);
    };

    // Close handlers
    confirmOverlay.querySelectorAll('.popup-close').forEach((btn) => {
        btn.onclick = () => confirmOverlay.remove();
    });
    confirmOverlay.onclick = (e) => {
        if (e.target === confirmOverlay) confirmOverlay.remove();
    };

    // Close on escape key
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            confirmOverlay.remove();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
}

// --- Mail simulator ---
function pushEmail({ subj, body, apptId, to }) {
    const mail = { id: state.nextEmailId++, subj, body, apptId, status: 'SENT', to };
    state.emails.unshift(mail); // newest first
    renderMail();
    saveState();
}

function renderMail() {
    const list = document.getElementById('mailList');
    if (!list) return;
    list.innerHTML = '';
    if (state.emails.length === 0) {
        const empty = document.createElement('div');
        empty.style.color = 'var(--sub)';
        empty.textContent =
            'Nog geen berichten — maak een tijdelijke afspraak om een e-mail te versturen.';
        list.appendChild(empty);
        return;
    }
    state.emails.forEach((m) => {
        const card = document.createElement('div');
        card.className = 'mail';
        const subj = document.createElement('div');
        subj.className = 'subj';
        subj.textContent = m.subj;
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = `To: ${m.to || 'client@example.com'} • #${m.id}`;
        const body = document.createElement('div');
        body.innerHTML = m.body;
        card.append(subj, meta, body);

        const appt = state.appts[m.apptId];
        if (appt && appt.status === 'TEMP') {
            // Add timer info for temp appointments
            let timerInfo = '';
            if (appt.expiresAt) {
                const remaining = getTimeRemainingForAppointment(appt);
                if (remaining !== null) {
                    timerInfo = document.createElement('div');
                    timerInfo.className = 'meta';
                    timerInfo.style.color = remaining > 0 ? 'var(--yellow)' : 'var(--red)';
                    timerInfo.innerHTML = `⏰ <strong>${formatTimeRemaining(remaining)}</strong>`;
                    card.appendChild(timerInfo);
                }
            }

            const actions = document.createElement('div');
            actions.className = 'actions';
            const ok = document.createElement('button');
            ok.className = 'btn approve';
            ok.textContent = 'Goedkeuren';
            ok.onclick = () => confirmAppointment(m.apptId);
            const rej = document.createElement('button');
            rej.className = 'btn reject';
            rej.textContent = 'Afwijzen';
            rej.onclick = () => rejectAppointment(m.apptId);
            actions.append(ok, rej);
            card.appendChild(actions);
        } else if (appt) {
            const info = document.createElement('div');
            info.className = 'meta';
            info.textContent = `Status: ${getStatusLabel(appt.status)}`;
            card.appendChild(info);
        }
        list.appendChild(card);
    });
}

// --- Appointment creation & transitions ---
function createTempAppointment(dateKey, startHHMM, endHHMM, email, customerName, companyId = null) {
    const cId = companyId || state.selectedCompanyId;
    ensureDay(dateKey, cId);
    const slots = state.schedule[cId][dateKey];
    const startIdx = (hhmmToMinutes(startHHMM) - WORK_START * 60) / SLOT_MIN;
    const endIdx = (hhmmToMinutes(endHHMM) - WORK_START * 60) / SLOT_MIN; // end boundary
    if (endIdx <= startIdx) return alert('Ongeldig tijdsbereik');
    for (let i = startIdx; i < endIdx; i++) {
        if (slots[i] !== 'FREE') {
            if (slots[i] === 'UNAVAILABLE') {
                return alert('Geselecteerde tijdslots zijn gemarkeerd als niet beschikbaar');
            }
            return alert('Tijdslot niet beschikbaar');
        }
    }
    for (let i = startIdx; i < endIdx; i++) slots[i] = 'TEMP';
    const id = state.nextApptId++;
    const company = COMPANIES.find((c) => c.id === cId);
    const expiresAt = Date.now() + TEMP_HOLD_DURATION;
    const appt = {
        companyId: cId,
        companyName: company ? company.name : 'Unknown Company',
        dateKey,
        startIdx,
        endIdx,
        status: 'TEMP',
        email: email || 'client@example.com',
        customerName: customerName || 'Unknown Client',
        expiresAt: expiresAt,
        createdAt: Date.now()
    };
    if (email && email.includes('@')) appt.email = email;
    state.appts[id] = appt;
    renderDay();
    renderMonth();
    renderSidebarMonth();
    refreshMultiCalendarIfActive();
    saveState();

    const timeRemaining = formatTimeRemaining(TEMP_HOLD_DURATION);
    const subj = `Uw afspraak is tijdelijk gereserveerd – bevestig binnen ${Math.floor(
        TEMP_HOLD_DURATION / (60 * 60 * 1000)
    )} uur`;
    const body = `<p>Bedankt voor uw verzoek.</p>
<p><strong>Bedrijf:</strong> ${appt.companyName}<br/>
<strong>Datum:</strong> ${dateKey}<br/>
<strong>Tijd:</strong> ${startHHMM}–${endHHMM}</p>
<p>Deze boeking is <em>tijdelijk</em> en verloopt over <strong>${timeRemaining}</strong>. Klik hieronder op Goedkeuren of Afwijzen.</p>
<p><em>⏰ U heeft ${Math.floor(
        TEMP_HOLD_DURATION / (60 * 60 * 1000)
    )} uur om te reageren voordat deze reservering verloopt.</em></p>`;
    pushEmail({ subj, body, apptId: id, to: email || 'klant@voorbeeld.nl' });
    return id;
}

function createFinalAppointment(
    dateKey,
    startHHMM,
    endHHMM,
    email,
    customerName,
    companyId = null
) {
    const cId = companyId || state.selectedCompanyId;
    ensureDay(dateKey, cId);
    const slots = state.schedule[cId][dateKey];
    const startIdx = (hhmmToMinutes(startHHMM) - WORK_START * 60) / SLOT_MIN;
    const endIdx = (hhmmToMinutes(endHHMM) - WORK_START * 60) / SLOT_MIN; // end boundary
    if (endIdx <= startIdx) return alert('Ongeldig tijdsbereik');
    for (let i = startIdx; i < endIdx; i++) {
        if (slots[i] !== 'FREE') {
            if (slots[i] === 'UNAVAILABLE') {
                return alert('Geselecteerde tijdslots zijn gemarkeerd als niet beschikbaar');
            }
            return alert('Tijdslot niet beschikbaar');
        }
    }
    for (let i = startIdx; i < endIdx; i++) slots[i] = 'BOOKED';
    const id = state.nextApptId++;
    const company = COMPANIES.find((c) => c.id === cId);
    const appt = {
        companyId: cId,
        companyName: company ? company.name : 'Unknown Company',
        dateKey,
        startIdx,
        endIdx,
        status: 'CONFIRMED',
        email: email || 'klant@voorbeeld.nl',
        customerName: customerName || 'Onbekende Klant'
    };
    state.appts[id] = appt;
    renderDay();
    renderMonth();
    renderSidebarMonth();
    refreshMultiCalendarIfActive();
    saveState();

    const subj = `Uw afspraak is bevestigd`;
    const body = `<p>Uw afspraak is bevestigd!</p>
<p><strong>Bedrijf:</strong> ${appt.companyName}<br/>
<strong>Datum:</strong> ${dateKey}<br/>
<strong>Tijd:</strong> ${startHHMM}–${endHHMM}</p>
<p>We kijken ernaar uit u te zien.</p>`;
    pushEmail({ subj, body, apptId: id, to: email || 'klant@voorbeeld.nl' });
    return id;
}

function confirmAppointment(apptId) {
    const appt = state.appts[apptId];
    if (!appt) return;

    // Check if appointment has expired
    if (isAppointmentExpired(appt)) {
        // Check if slots are still available
        const slots = state.schedule[appt.companyId][appt.dateKey];
        let slotsAvailable = true;
        for (let i = appt.startIdx; i < appt.endIdx; i++) {
            if (slots[i] === 'BOOKED') {
                slotsAvailable = false;
                break;
            }
        }

        if (slotsAvailable) {
            // Slots are still free, allow late confirmation
            for (let i = appt.startIdx; i < appt.endIdx; i++) {
                slots[i] = 'BOOKED';
            }
            appt.status = 'CONFIRMED';
            appt.expiresAt = null; // Clear expiration

            // Send late confirmation email
            const subj = `Uw afspraak is bevestigd (late reactie geaccepteerd)`;
            const body = `<p>Dank u voor uw reactie!</p>
<p>Hoewel uw tijdelijke reservering was verlopen, waren de tijdslots nog steeds beschikbaar en is uw afspraak <strong>bevestigd</strong>.</p>
<p><strong>Bedrijf:</strong> ${appt.companyName}<br/>
<strong>Datum:</strong> ${appt.dateKey}<br/>
<strong>Tijd:</strong> ${minutesToHHMM(appt.startIdx * SLOT_MIN + WORK_START * 60)}–${minutesToHHMM(
                appt.endIdx * SLOT_MIN + WORK_START * 60
            )}</p>
<p>We kijken ernaar uit u te zien.</p>`;
            pushEmail({ subj, body, apptId: null, to: appt.email });
        } else {
            // Slots are no longer available
            appt.status = 'EXPIRED_UNAVAILABLE';

            // Send unavailable email
            const subj = `Kan verlopen reservering niet bevestigen`;
            const body = `<p>Helaas kunnen we uw afspraakverzoek niet bevestigen.</p>
<p>Uw tijdelijke reservering is verlopen en de gevraagde tijdslots zijn door andere klanten geboekt.</p>
<p><strong>Oorspronkelijk aangevraagd:</strong><br/>
<strong>Bedrijf:</strong> ${appt.companyName}<br/>
<strong>Datum:</strong> ${appt.dateKey}<br/>
<strong>Tijd:</strong> ${minutesToHHMM(appt.startIdx * SLOT_MIN + WORK_START * 60)}–${minutesToHHMM(
                appt.endIdx * SLOT_MIN + WORK_START * 60
            )}</p>
<p>Maak alstublieft een nieuw boekingsverzoek om beschikbare alternatieven te zien.</p>`;
            pushEmail({ subj, body, apptId: null, to: appt.email });
        }
    } else {
        // Normal confirmation (not expired)
        const slots = state.schedule[appt.companyId][appt.dateKey];
        for (let i = appt.startIdx; i < appt.endIdx; i++) {
            slots[i] = 'BOOKED';
        }
        appt.status = 'CONFIRMED';
        appt.expiresAt = null; // Clear expiration
    }

    renderDay();
    renderMonth();
    renderSidebarMonth();
    refreshMultiCalendarIfActive();
    renderMail();
    saveState();
}

function rejectAppointment(apptId) {
    const appt = state.appts[apptId];
    if (!appt) return;
    const slots = state.schedule[appt.companyId][appt.dateKey];
    for (let i = appt.startIdx; i < appt.endIdx; i++) slots[i] = 'FREE';
    appt.status = 'REJECTED';
    renderDay();
    renderMonth();
    renderSidebarMonth();
    refreshMultiCalendarIfActive();
    renderMail();
    saveState();
}

function cancelAppointment(apptId) {
    const appt = state.appts[apptId];
    if (!appt) return;

    // Show confirmation dialog
    const customerName = appt.customerName || (appt.client ? appt.client.name : 'Onbekend');
    const startTime = minutesToHHMM(WORK_START * 60 + appt.startIdx * SLOT_MIN);
    const endTime = minutesToHHMM(WORK_START * 60 + appt.endIdx * SLOT_MIN);

    const confirmCancel = confirm(
        `Weet u zeker dat u deze afspraak wilt annuleren?\n\n` +
            `Klant: ${customerName}\n` +
            `Datum: ${appt.dateKey}\n` +
            `Tijd: ${startTime} - ${endTime}\n\n` +
            `Deze actie kan niet ongedaan worden gemaakt.`
    );

    if (!confirmCancel) return;

    // Free up the time slots
    const slots = state.schedule[appt.companyId][appt.dateKey];
    for (let i = appt.startIdx; i < appt.endIdx; i++) slots[i] = 'FREE';

    // Mark appointment as cancelled
    appt.status = 'CANCELLED';

    // Send cancellation email
    const email = appt.email || (appt.client ? appt.client.email : '');
    if (email && email.includes('@')) {
        const subj = `Afspraak Geannuleerd - ${appt.dateKey}`;
        const body = `<p>Beste ${customerName},</p>
<p>We moeten u helaas meedelen dat uw afspraak is geannuleerd.</p>
<p><strong>Bedrijf:</strong> ${appt.companyName || 'Loodgieterservice'}<br/>
<strong>Datum:</strong> ${appt.dateKey}<br/>
<strong>Tijd:</strong> ${startTime}–${endTime}</p>
<p>We verontschuldigen ons voor het ongemak dat dit kan veroorzaken. Neem contact met ons op om opnieuw af te spreken.</p>
<p>Met vriendelijke groet,<br/>
${appt.companyName || 'Loodgieterservice'}</p>`;
        pushEmail({ subj, body, apptId, to: email });
    }

    // Update all views
    renderDay();
    renderMonth();
    renderSidebarMonth();
    refreshMultiCalendarIfActive();
    saveState();

    // Close the popup
    const overlay = document.querySelector('.popup-overlay');
    if (overlay) {
        document.body.removeChild(overlay);
    }
}

// --- Requests (Admin) ---
function renderRequests() {
    const list = document.getElementById('requestList');
    if (!list) return;
    list.innerHTML = '';
    if (state.requests.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'note';
        empty.textContent = 'Nog geen verzoeken.';
        list.appendChild(empty);
        return;
    }
    state.requests.forEach((req) => {
        const card = document.createElement('div');
        card.className = 'mail';
        const subj = document.createElement('div');
        subj.className = 'subj';
        subj.textContent = `${req.customer.name} – ${req.serviceName}`;
        const meta = document.createElement('div');
        meta.className = 'meta';
        const prefTime = req.preferred?.dateKey
            ? `${req.preferred.dateKey} ${req.preferred.startHHMM}–${req.preferred.endHHMM}`
            : '—';
        const availableCompaniesText = req.availableCompanies
            ? req.availableCompanies
                  .map((cId) => COMPANIES.find((c) => c.id === cId)?.name || cId)
                  .join(', ')
            : 'Any';
        meta.textContent = `#REQ${req.id} • ${new Date(
            req.createdAt
        ).toLocaleString()} • Preferred: ${prefTime} • Available Companies: ${availableCompaniesText} • Status: ${
            req.status
        }`;
        const body = document.createElement('div');
        const estText =
            req.estimate == null ? 'Quotation will be provided' : `€${req.estimate.toFixed(2)}`;
        body.innerHTML = `<p><strong>Estimate:</strong> ${estText}</p><pre style="white-space:pre-wrap">${JSON.stringify(
            req.answers,
            null,
            2
        )}</pre>`;
        card.append(subj, meta, body);

        // actions
        const actions = document.createElement('div');
        actions.className = 'actions';

        // Company selection for proposed appointments
        const companySelectDiv = document.createElement('div');
        companySelectDiv.style.marginBottom = '8px';
        const companyLabel = document.createElement('label');
        companyLabel.textContent = 'Toewijzen aan Bedrijf: ';
        companyLabel.style.color = 'var(--sub)';
        companyLabel.style.fontSize = '12px';
        const companySelect = document.createElement('select');
        companySelect.style.background = 'var(--muted)';
        companySelect.style.border = '1px solid var(--border)';
        companySelect.style.color = 'var(--text)';
        companySelect.style.padding = '4px 8px';
        companySelect.style.borderRadius = '6px';
        companySelect.style.marginLeft = '8px';

        if (req.availableCompanies && req.availableCompanies.length > 0) {
            req.availableCompanies.forEach((companyId) => {
                const company = COMPANIES.find((c) => c.id === companyId);
                if (company) {
                    const option = document.createElement('option');
                    option.value = company.id;
                    option.textContent = company.name;
                    companySelect.appendChild(option);
                }
            });
        } else {
            COMPANIES.forEach((company) => {
                const option = document.createElement('option');
                option.value = company.id;
                option.textContent = company.name;
                companySelect.appendChild(option);
            });
        }
        companySelectDiv.appendChild(companyLabel);
        companySelectDiv.appendChild(companySelect);

        const btnPropReq = document.createElement('button');
        btnPropReq.className = 'btn approve';
        btnPropReq.textContent = 'Gewenste Tijd Voorstellen';
        btnPropReq.onclick = () => {
            if (!req.preferred?.dateKey) {
                alert('Geen gewenste tijd geselecteerd door klant.');
                return;
            }
            const selectedCompanyId = companySelect.value;
            let apptId;
            if (req.hold) {
                apptId = createTempAppointmentFromHold(
                    req.hold.dateKey,
                    req.hold.startIdx,
                    req.hold.endIdx,
                    req.customer.email,
                    selectedCompanyId
                );
            } else {
                apptId = createTempAppointment(
                    req.preferred.dateKey,
                    req.preferred.startHHMM,
                    req.preferred.endHHMM,
                    req.customer.email,
                    req.customer.name,
                    selectedCompanyId
                );
            }
            if (apptId) {
                req.status = 'PROPOSED';
                req.apptId = apptId;
                req.assignedCompanyId = selectedCompanyId;
                saveState();
                renderRequests();
            }
        };

        const customWrap = document.createElement('div');
        customWrap.style.display = 'grid';
        customWrap.style.gridTemplateColumns = '1fr 1fr 1fr 1fr auto';
        customWrap.style.gap = '6px';
        customWrap.style.marginTop = '8px';
        const d = document.createElement('input');
        d.type = 'date';
        d.value = req.preferred?.dateKey || formatDateKey(new Date());
        const s = document.createElement('select');
        const e = document.createElement('select');
        [s, e].forEach((sel) => {
            const startMin = WORK_START * 60;
            const total = ((WORK_END - WORK_START) * 60) / SLOT_MIN;
            sel.innerHTML = '';
            for (let i = 0; i <= total; i++) {
                const t = minutesToHHMM(startMin + i * SLOT_MIN);
                const o = document.createElement('option');
                o.value = t;
                o.textContent = t;
                sel.appendChild(o);
            }
        });

        // Company select for custom time
        const customCompanySelect = document.createElement('select');
        customCompanySelect.style.background = 'var(--muted)';
        customCompanySelect.style.border = '1px solid var(--border)';
        customCompanySelect.style.color = 'var(--text)';
        customCompanySelect.style.padding = '6px 8px';
        customCompanySelect.style.borderRadius = '6px';

        COMPANIES.forEach((company) => {
            const option = document.createElement('option');
            option.value = company.id;
            option.textContent = company.name;
            customCompanySelect.appendChild(option);
        });

        const btnProp = document.createElement('button');
        btnProp.className = 'btn';
        btnProp.textContent = 'Aangepaste Tijd Voorstellen';
        btnProp.onclick = () => {
            releaseHold(req);
            const selectedCompanyId = customCompanySelect.value;
            const apptId = createTempAppointment(
                d.value,
                s.value,
                e.value,
                req.customer.email,
                req.customer.name,
                selectedCompanyId
            );
            if (apptId) {
                req.status = 'PROPOSED';
                req.apptId = apptId;
                req.assignedCompanyId = selectedCompanyId;
                req.preferred = { dateKey: d.value, startHHMM: s.value, endHHMM: e.value };
                saveState();
                renderRequests();
            }
        };
        customWrap.append(d, s, e, customCompanySelect, btnProp);

        const btnReject = document.createElement('button');
        btnReject.className = 'btn reject';
        btnReject.textContent = 'Verzoek Afwijzen';
        btnReject.onclick = () => {
            releaseHold(req);
            req.status = 'REJECTED';
            saveState();
            renderRequests();
            pushEmail({
                subj: 'Your request was reviewed',
                body: `<p>We couldn't schedule the requested time. Please reply to choose another slot.</p>`,
                apptId: null,
                to: req.customer.email
            });
        };

        // Add Approve button for admin to confirm booking
        const btnApprove = document.createElement('button');
        btnApprove.className = 'btn approve';
        btnApprove.textContent = 'Goedkeuren';
        btnApprove.onclick = () => {
            // Book the spot for the client and create an appointment record
            if (req.hold) {
                const { dateKey, startIdx, endIdx, companyId } = req.hold;
                ensureDay(dateKey, companyId);
                const slots = state.schedule[companyId][dateKey];
                for (let i = startIdx; i < endIdx; i++) {
                    slots[i] = 'BOOKED';
                }
                const company = COMPANIES.find((c) => c.id === companyId);
                const newApptId = state.nextApptId++;
                state.appts[newApptId] = {
                    companyId,
                    companyName: company ? company.name : 'Unknown Company',
                    dateKey,
                    startIdx,
                    endIdx,
                    status: 'CONFIRMED',
                    client: req.customer,
                    customerName: req.customer.name,
                    email: req.customer.email,
                    serviceName: req.serviceName
                };
                req.apptId = newApptId;
                req.assignedCompanyId = companyId;
                // Remove hold
                delete req.hold;
                req.status = 'CONFIRMED';
                saveState();
                renderRequests();
                renderMonth();
                renderDay();
                // Send confirmation email to client
                pushEmail({
                    subj: 'Your appointment is confirmed',
                    body: `<p>Dear ${req.customer.name},</p><p>Your booking for <strong>${
                        req.serviceName
                    }</strong> with <strong>${
                        company ? company.name : 'Unknown Company'
                    }</strong> on <strong>${dateKey}</strong> at <strong>${minutesToHHMM(
                        WORK_START * 60 + startIdx * SLOT_MIN
                    )}–${minutesToHHMM(
                        WORK_START * 60 + endIdx * SLOT_MIN
                    )}</strong> is <span style='color:var(--green)'><strong>confirmed</strong></span>!</p>`,
                    apptId: newApptId,
                    to: req.customer.email
                });
            }
        };

        actions.append(btnPropReq, btnApprove, btnReject);
        card.appendChild(companySelectDiv);
        card.appendChild(actions);
        card.appendChild(customWrap);

        list.appendChild(card);
    });
}

function releaseHold(req) {
    if (req?.hold) {
        const { dateKey, startIdx, endIdx, companyId } = req.hold;
        ensureDay(dateKey, companyId);
        const slots = state.schedule[companyId][dateKey];
        for (let i = startIdx; i < endIdx; i++) {
            if (slots[i] === 'TEMP') slots[i] = 'FREE';
        }
        delete req.hold;
        renderDay();
        renderMonth();
        saveState();
    }
}

function createTempAppointmentFromHold(dateKey, startIdx, endIdx, email, companyId) {
    const startHHMM = minutesToHHMM(WORK_START * 60 + startIdx * SLOT_MIN);
    const endHHMM = minutesToHHMM(WORK_START * 60 + endIdx * SLOT_MIN);
    const id = state.nextApptId++;

    // Find matching request to get customer info
    const match = state.requests.find(
        (r) =>
            r.hold &&
            r.hold.dateKey === dateKey &&
            r.hold.startIdx === startIdx &&
            r.hold.endIdx === endIdx
    );

    const company = COMPANIES.find((c) => c.id === companyId);
    const expiresAt = Date.now() + TEMP_HOLD_DURATION;
    const appt = {
        companyId: companyId,
        companyName: company ? company.name : 'Unknown Company',
        dateKey,
        startIdx,
        endIdx,
        status: 'TEMP',
        email: email || 'client@example.com',
        expiresAt: expiresAt,
        createdAt: Date.now()
    };

    if (match) {
        appt.client = match.customer;
        appt.customerName = match.customer.name;
        appt.email = match.customer.email;
        appt.serviceName = match.serviceName;
        match.apptId = id;
        match.assignedCompanyId = companyId;
        // Remove the hold since we now have a proper appointment
        match.hold = null;
    } else {
        appt.customerName = 'Unknown Client';
    }

    state.appts[id] = appt;

    const timeRemaining = formatTimeRemaining(TEMP_HOLD_DURATION);
    const subj = `Your appointment is temporarily reserved – please confirm within ${Math.floor(
        TEMP_HOLD_DURATION / (60 * 60 * 1000)
    )} hours`;
    const body = `<p>Thanks for your request.</p>
<p><strong>Company:</strong> ${appt.companyName}<br/>
<strong>Date:</strong> ${dateKey}<br/>
<strong>Time:</strong> ${startHHMM}–${endHHMM}</p>
<p>This booking is <em>temporary</em> and will expire in <strong>${timeRemaining}</strong>. Please Approve or Reject below.</p>
<p><em>⏰ You have ${Math.floor(
        TEMP_HOLD_DURATION / (60 * 60 * 1000)
    )} hours to respond before this reservation expires.</em></p>`;
    pushEmail({ subj, body, apptId: id, to: appt.email });
    renderDay();
    renderMonth();
    saveState();
    return id;
}

// --- Client Booking Page ---
function populateServiceSelect() {
    const sel = document.getElementById('c_service');
    if (!sel) return;
    sel.innerHTML = '<option value="">Selecteer een service…</option>';
    SERVICES.forEach((s) => {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = s.name;
        sel.appendChild(o);
    });
}

function renderQuestions() {
    const wrap = document.getElementById('c_questions');
    if (!wrap) return;
    wrap.innerHTML = '';
    const service = SERVICES.find((s) => s.id === state.clientSelection.serviceId);
    if (!service) {
        updateClientUI();
        return;
    }
    service.questions.forEach((q) => {
        const f = document.createElement('div');
        f.className = 'field';
        const lab = document.createElement('label');
        lab.textContent = q.label;
        f.appendChild(lab);
        let input;
        if (q.type === 'select') {
            input = document.createElement('select');
            q.options.forEach((opt) => {
                const o = document.createElement('option');
                o.value = opt;
                o.textContent = opt;
                input.appendChild(o);
            });
        } else if (q.type === 'boolean') {
            input = document.createElement('select');
            ['No', 'Yes'].forEach((v) => {
                const o = document.createElement('option');
                o.value = v === 'Yes';
                o.textContent = v;
                input.appendChild(o);
            });
        } else if (q.type === 'number') {
            input = document.createElement('input');
            input.type = 'number';
            input.min = '0';
            input.step = '1';
            input.placeholder = '0';
        } else {
            input = document.createElement('input');
        }
        input.dataset.key = q.key;
        input.onchange = () => {
            updateEstimate();
            updateClientUI();
        };
        input.oninput = () => {
            updateEstimate();
            updateClientUI();
        };
        f.appendChild(input);
        wrap.appendChild(f);
    });
    updateEstimate();
    updateClientUI();
}

function collectAnswers() {
    const wrap = document.getElementById('c_questions');
    if (!wrap) return {};
    const ans = {};
    wrap.querySelectorAll('[data-key]').forEach((el) => {
        const key = el.dataset.key;
        if (el.type === 'number') ans[key] = Number(el.value || 0);
        else if (
            el.tagName === 'SELECT' &&
            (el.options[0]?.text === 'No' || el.options[0]?.text === 'Yes')
        )
            ans[key] = el.value === 'true' || el.value === true;
        else if (el.tagName === 'SELECT') ans[key] = el.value;
        else ans[key] = el.value;
    });
    return ans;
}

function updateEstimate() {
    const el = document.getElementById('c_estimate');
    const service = SERVICES.find((s) => s.id === state.clientSelection.serviceId);
    if (!service) {
        el.textContent = 'Selecteer een service…';
        return;
    }
    const ans = collectAnswers();
    const price = service.price(ans);
    if (price == null) {
        el.textContent = 'Offerte wordt verstrekt';
    } else {
        el.textContent = `~ €${price.toFixed(2)}`;
    }
}

function getFreeWindows(dateKey, durationSlots) {
    const windows = [];

    // Get available slots from any company
    for (const company of COMPANIES) {
        ensureDay(dateKey, company.id);
        const slots = state.schedule[company.id][dateKey];

        for (let i = 0; i <= slots.length - durationSlots; i++) {
            let ok = true;
            for (let j = 0; j < durationSlots; j++) {
                if (slots[i + j] !== 'FREE') {
                    ok = false;
                    break;
                }
            }
            if (ok) {
                const startHHMM = minutesToHHMM(WORK_START * 60 + i * SLOT_MIN);
                const endHHMM = minutesToHHMM(WORK_START * 60 + (i + durationSlots) * SLOT_MIN);

                // Check if this time slot is already in windows
                const exists = windows.find(
                    (w) => w.startIdx === i && w.endIdx === i + durationSlots
                );
                if (!exists) {
                    windows.push({
                        startIdx: i,
                        endIdx: i + durationSlots,
                        startHHMM,
                        endHHMM,
                        availableCompanies: [company]
                    });
                } else {
                    // Add this company to available companies for this time slot
                    exists.availableCompanies.push(company);
                }
            }
        }
    }

    return windows;
}

function clientFormErrors() {
    const errs = [];
    const name = document.getElementById('c_name').value.trim();
    if (!name) errs.push('Voer uw naam in.');
    const email = document.getElementById('c_email').value.trim();
    if (!emailValid(email)) errs.push('Voer een geldig e-mailadres in.');
    const serviceId = document.getElementById('c_service').value;
    if (!serviceId) errs.push('Selecteer een service.');
    const qs = document.querySelectorAll('#c_questions [data-key]');
    qs.forEach((el) => {
        if (el.type === 'number') {
            if (el.value === '') errs.push(`Vul ${el.dataset.key} in.`);
        } else if (el.tagName === 'SELECT' || el.tagName === 'INPUT') {
            if (el.value === '') errs.push(`Vul ${el.dataset.key} in.`);
        }
    });
    return errs;
}

function updateClientUI() {
    const right = document.getElementById('client-right');
    if (!right) return;
    const errs = clientFormErrors();
    if (errs.length) {
        right.classList.add('hidden');
        showClientError(errs.join(' '));
    } else {
        right.classList.remove('hidden');
        clearClientError();
        renderClientTimes();
    }
}

function renderClientTimes() {
    const grid = document.getElementById('c_times');
    if (!grid) return;
    grid.innerHTML = '';
    const dateKey = document.getElementById('c_date').value;
    const service = SERVICES.find((s) => s.id === state.clientSelection.serviceId);
    if (!service || !dateKey) return;
    const wins = getFreeWindows(dateKey, service.durationSlots);
    if (wins.length === 0) {
        grid.innerHTML = '<div class="note">Geen vrije tijdslots op deze dag.</div>';
        return;
    }
    wins.forEach((w, idx) => {
        const b = document.createElement('button');
        b.className = 'timebtn';
        b.textContent = `${w.startHHMM}–${w.endHHMM}`;
        b.onclick = () => {
            state.clientSelection.dateKey = dateKey;
            state.clientSelection.startIdx = w.startIdx;
            state.clientSelection.endIdx = w.endIdx;
            state.clientSelection.startHHMM = w.startHHMM;
            state.clientSelection.endHHMM = w.endHHMM;
            document.getElementById(
                'c_selected'
            ).textContent = `${w.startHHMM}–${w.endHHMM} on ${dateKey}`;
            grid.querySelectorAll('.timebtn').forEach((x) => x.classList.remove('selected'));
            b.classList.add('selected');
            clearClientError();
        };
        grid.appendChild(b);
    });
}

function sendClientRequest() {
    clearClientError();
    const errs = clientFormErrors();
    if (errs.length) {
        showClientError(errs.join(' '));
        return;
    }

    const name = document.getElementById('c_name').value.trim();
    const email = document.getElementById('c_email').value.trim();
    const service = SERVICES.find((s) => s.id === state.clientSelection.serviceId);
    const sel = state.clientSelection;
    if (!service || !sel.dateKey || sel.startIdx == null) {
        showClientError('Kies een datum en tijd.');
        return;
    }

    // Find which companies have this slot available
    const availableCompanies = [];
    for (const company of COMPANIES) {
        ensureDay(sel.dateKey, company.id);
        const slots = state.schedule[company.id][sel.dateKey];
        let available = true;
        for (let i = sel.startIdx; i < sel.endIdx; i++) {
            if (slots[i] !== 'FREE') {
                available = false;
                break;
            }
        }
        if (available) {
            availableCompanies.push(company.id);
        }
    }

    if (availableCompanies.length === 0) {
        showClientError('Geselecteerde tijd is niet meer beschikbaar. Kies een ander tijdslot.');
        return;
    }

    // Hold the slot as TEMP in one available company (we'll let admin choose which one)
    const selectedCompanyId = availableCompanies[0];
    ensureDay(sel.dateKey, selectedCompanyId);
    const slots = state.schedule[selectedCompanyId][sel.dateKey];
    for (let i = sel.startIdx; i < sel.endIdx; i++) slots[i] = 'TEMP';

    const ans = collectAnswers();
    const estimate = service.price(ans);

    const req = {
        id: state.nextRequestId++,
        createdAt: Date.now(),
        customer: { name, email },
        serviceId: service.id,
        serviceName: service.name,
        answers: ans,
        estimate: estimate,
        preferred: {
            dateKey: sel.dateKey,
            startIdx: sel.startIdx,
            endIdx: sel.endIdx,
            startHHMM: sel.startHHMM,
            endHHMM: sel.endHHMM
        },
        availableCompanies: availableCompanies,
        hold: {
            dateKey: sel.dateKey,
            startIdx: sel.startIdx,
            endIdx: sel.endIdx,
            companyId: selectedCompanyId
        },
        status: 'NEW'
    };
    state.requests.unshift(req);
    saveState();
    renderRequests();
    renderMonth();
    renderDay();
    document.getElementById('c_result').textContent =
        'Request sent! The time is held temporarily while we review.';

    // Acknowledgement email in simulator
    pushEmail({
        subj: 'We received your request',
        body: `<p>Thanks ${name}! We will review your request for <strong>${service.name}</strong> and propose a time.</p>`,
        apptId: null,
        to: email
    });
}

// --- UI actions ---
function onHoldClick() {
    const dateKey = document.getElementById('datePicker').value;
    const start = document.getElementById('startTime').value;
    const end = document.getElementById('endTime').value;
    const email = document.getElementById('clientEmail').value;
    const customerName = document.getElementById('customerName').value;
    ensureDay(dateKey);
    createTempAppointment(dateKey, start, end, email, customerName);
}

function onBookFinalClick() {
    const dateKey = document.getElementById('datePicker').value;
    const start = document.getElementById('startTime').value;
    const end = document.getElementById('endTime').value;
    const email = document.getElementById('clientEmail').value;
    const customerName = document.getElementById('customerName').value;
    ensureDay(dateKey);
    createFinalAppointment(dateKey, start, end, email, customerName);
}

function onResetDay() {
    const key = document.getElementById('datePicker').value;
    ensureDay(key);
    const slots = state.schedule[state.selectedCompanyId][key];
    if (!slots) return;
    for (let i = 0; i < slots.length; i++) slots[i] = 'FREE';
    renderDay();
    renderMonth();
    renderSidebarMonth();
    refreshMultiCalendarIfActive();
    saveState();
}

function clearAllData() {
    if (confirm('Clear all demo data and reset?')) {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
    }
}

// --- Weekly Availability Management ---

// Get the start of the week (Monday) for a given date
function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
    return new Date(d.setDate(diff));
}

// Get all dates in a week starting from Monday
function getWeekDates(startDate) {
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        dates.push(date);
    }
    return dates;
}

// Check if there are any TEMP or BOOKED slots in the given range
function checkConflictingAppointments(dateKeys, companyId) {
    const conflicts = [];

    for (const dateKey of dateKeys) {
        ensureDay(dateKey, companyId);
        const slots = state.schedule[companyId][dateKey];

        for (let i = 0; i < slots.length; i++) {
            if (slots[i] === 'TEMP' || slots[i] === 'BOOKED') {
                const startTime = minutesToHHMM(i * SLOT_MIN + WORK_START * 60);
                const endTime = minutesToHHMM((i + 1) * SLOT_MIN + WORK_START * 60);
                conflicts.push({
                    dateKey,
                    slotIndex: i,
                    status: slots[i],
                    time: `${startTime}-${endTime}`
                });
            }
        }
    }

    return conflicts;
}

// Show conflicts popup
function showConflictsPopup(conflicts, operation) {
    const conflictsByDate = {};
    conflicts.forEach((conflict) => {
        if (!conflictsByDate[conflict.dateKey]) {
            conflictsByDate[conflict.dateKey] = [];
        }
        conflictsByDate[conflict.dateKey].push(conflict);
    });

    let content = `<div class="conflict-warning">
        <p><strong>Cannot ${operation} - Conflicting appointments found:</strong></p>
        <div class="conflicts-list">`;

    Object.keys(conflictsByDate).forEach((dateKey) => {
        const date = parseDateKey(dateKey);
        const dayName = date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric'
        });
        content += `<div class="conflict-day">
            <div class="conflict-date">${dayName}</div>
            <ul class="conflict-slots">`;

        conflictsByDate[dateKey].forEach((conflict) => {
            const statusLabel = conflict.status === 'TEMP' ? 'Temporary Hold' : 'Booked';
            content += `<li>${conflict.time} - ${statusLabel}</li>`;
        });

        content += `</ul></div>`;
    });

    content += `</div>
        <p><strong>Please cancel or modify these appointments first, then try again.</strong></p>
    </div>`;

    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay';
    overlay.innerHTML = `
        <div class="popup conflict-popup">
            <button class="popup-close">×</button>
            <h3>⚠️ Scheduling Conflict</h3>
            <div class="popup-info">
                ${content}
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Close handlers
    overlay.querySelector('.popup-close').onclick = () => overlay.remove();
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };
}

// Set availability for multiple days
function setAvailability(dateKeys, availability, companyId) {
    const cId = companyId || state.selectedCompanyId;

    // Check for conflicts first
    if (availability === 'UNAVAILABLE') {
        const conflicts = checkConflictingAppointments(dateKeys, cId);
        if (conflicts.length > 0) {
            showConflictsPopup(conflicts, 'set as unavailable');
            return false;
        }
    }

    // Apply the availability setting
    dateKeys.forEach((dateKey) => {
        ensureDay(dateKey, cId);
        const slots = state.schedule[cId][dateKey];

        for (let i = 0; i < slots.length; i++) {
            if (availability === 'FREE') {
                // Only change UNAVAILABLE slots to FREE, preserve TEMP/BOOKED
                if (slots[i] === 'UNAVAILABLE') {
                    slots[i] = 'FREE';
                }
            } else if (availability === 'UNAVAILABLE') {
                // Only change FREE slots to UNAVAILABLE, preserve TEMP/BOOKED
                if (slots[i] === 'FREE') {
                    slots[i] = 'UNAVAILABLE';
                }
            }
        }
    });

    // Re-render everything
    renderDay();
    renderMonth();
    renderSidebarMonth();
    refreshMultiCalendarIfActive();
    saveState();

    return true;
}

// Set weekly availability
function setWeeklyAvailability(pattern, availability, companyId) {
    const cId = companyId || state.selectedCompanyId;
    const weekStart = getWeekStart(state.selectedDate);
    const weekDates = getWeekDates(weekStart);

    let targetDates = [];

    switch (pattern) {
        case 'all':
            targetDates = weekDates;
            break;
        case 'odd':
            targetDates = weekDates.filter((_, index) => index % 2 === 0); // Mon, Wed, Fri, Sun (0,2,4,6)
            break;
        case 'even':
            targetDates = weekDates.filter((_, index) => index % 2 === 1); // Tue, Thu, Sat (1,3,5)
            break;
        case 'weekdays':
            targetDates = weekDates.slice(0, 5); // Mon-Fri
            break;
        case 'weekend':
            targetDates = weekDates.slice(5); // Sat-Sun
            break;
        default:
            return false;
    }

    const targetDateKeys = targetDates.map(formatDateKey);
    return setAvailability(targetDateKeys, availability, cId);
}

// Show weekly availability popup
function showWeeklyAvailabilityPopup() {
    const companyName = COMPANIES.find((c) => c.id === state.selectedCompanyId)?.name || 'Unknown';
    const weekStart = getWeekStart(state.selectedDate);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const weekRange = `${weekStart.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
    })} - ${weekEnd.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    })}`;

    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay';
    overlay.innerHTML = `
        <div class="popup weekly-availability-popup">
            <button class="popup-close">×</button>
            <h3>📅 Set Weekly Availability</h3>
            <div class="popup-info">
                <div class="week-info">
                    <p><strong>Company:</strong> ${companyName}</p>
                    <p><strong>Week:</strong> ${weekRange}</p>
                </div>
                
                <div class="availability-options">
                    <div class="option-group">
                        <label class="option-title">Pattern:</label>
                        <select id="weekPattern" class="week-select">
                            <option value="all">Entire Week (Mon-Sun)</option>
                            <option value="weekdays">Weekdays Only (Mon-Fri)</option>
                            <option value="weekend">Weekend Only (Sat-Sun)</option>
                            <option value="odd">Odd Days (Mon, Wed, Fri, Sun)</option>
                            <option value="even">Even Days (Tue, Thu, Sat)</option>
                        </select>
                    </div>
                    
                    <div class="option-group">
                        <label class="option-title">Set as:</label>
                        <select id="weekAvailability" class="week-select">
                            <option value="FREE">Available (Free)</option>
                            <option value="UNAVAILABLE">Unavailable (Busy)</option>
                        </select>
                    </div>
                </div>
                
                <div class="popup-actions">
                    <button id="applyWeeklyAvailability" class="btn primary">Apply Changes</button>
                    <button class="btn secondary popup-close">Cancel</button>
                </div>
                
                <div class="note">
                    <strong>Note:</strong> This will only affect FREE or UNAVAILABLE slots. Existing TEMP/BOOKED appointments will not be changed.
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Apply button handler
    overlay.querySelector('#applyWeeklyAvailability').onclick = () => {
        const pattern = overlay.querySelector('#weekPattern').value;
        const availability = overlay.querySelector('#weekAvailability').value;

        const success = setWeeklyAvailability(pattern, availability, state.selectedCompanyId);
        if (success) {
            overlay.remove();

            // Show success message
            const patternLabel = overlay.querySelector('#weekPattern').selectedOptions[0].text;
            const availabilityLabel = availability === 'FREE' ? 'Available' : 'Unavailable';
            alert(
                `Successfully set ${patternLabel.toLowerCase()} as ${availabilityLabel.toLowerCase()}.`
            );
        }
    };

    // Close handlers
    overlay.querySelectorAll('.popup-close').forEach((btn) => {
        btn.onclick = () => overlay.remove();
    });
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };
}

// --- Multi-Company Calendar Dashboard ---
const multiCalendarState = {
    cursor: new Date(),
    selectedDate: null,
    visibleCompanies: ['C1', 'C2']
};

function renderMultiCompanyCalendar() {
    const container = document.getElementById('multi-calendar');
    if (!container) return;

    container.innerHTML = '';
    const d = new Date(
        multiCalendarState.cursor.getFullYear(),
        multiCalendarState.cursor.getMonth(),
        1
    );
    const year = d.getFullYear();
    const month = d.getMonth();

    // Update month title
    const titleEl = document.getElementById('mc-month-title');
    if (titleEl) {
        titleEl.textContent = d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    }

    // Create header
    const header = document.createElement('div');
    header.className = 'calendar-header';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((day) => {
        const dow = document.createElement('div');
        dow.className = 'dow';
        dow.textContent = day;
        header.appendChild(dow);
    });

    // Create body
    const body = document.createElement('div');
    body.className = 'calendar-body';

    const firstDow = (d.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Previous month trailing days
    for (let i = 0; i < firstDow; i++) {
        const prevDate = new Date(year, month, i - firstDow + 1);
        const cell = createMultiCalendarDay(prevDate, true);
        body.appendChild(cell);
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
        const date = new Date(year, month, i);
        const cell = createMultiCalendarDay(date, false);
        body.appendChild(cell);
    }

    // Next month leading days
    const totalCells = firstDow + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= trailing; i++) {
        const nextDate = new Date(year, month + 1, i);
        const cell = createMultiCalendarDay(nextDate, true);
        body.appendChild(cell);
    }

    container.appendChild(header);
    container.appendChild(body);
}

function createMultiCalendarDay(date, isOut) {
    const dateKey = formatDateKey(date);
    const cell = document.createElement('div');
    cell.className = 'calendar-day' + (isOut ? ' out' : '');

    if (
        multiCalendarState.selectedDate &&
        formatDateKey(multiCalendarState.selectedDate) === dateKey
    ) {
        cell.classList.add('selected');
    }

    const dayNumber = document.createElement('div');
    dayNumber.className = 'day-number';
    dayNumber.textContent = date.getDate();

    const appointmentsContainer = document.createElement('div');
    appointmentsContainer.className = 'day-appointments';

    // Get appointments for this day across all visible companies
    const dayAppointments = getDayAppointments(dateKey);
    let displayedCount = 0;
    const maxDisplay = 3;

    dayAppointments.forEach((appt) => {
        if (displayedCount >= maxDisplay) return;
        if (!multiCalendarState.visibleCompanies.includes(appt.companyId)) return;

        const indicator = document.createElement('div');
        indicator.className = `appointment-indicator ${appt.status.toLowerCase()}`;

        const company = COMPANIES.find((c) => c.id === appt.companyId);
        const startTime = minutesToHHMM(WORK_START * 60 + appt.startIdx * SLOT_MIN);

        indicator.textContent = `${startTime} ${company ? company.name.split(' ')[0] : ''}`;
        indicator.title = `${startTime} - ${appt.customerName || 'Unknown'} (${
            company ? company.name : 'Unknown Company'
        })`;

        appointmentsContainer.appendChild(indicator);
        displayedCount++;
    });

    // Show overflow indicator
    const remainingCount =
        dayAppointments.filter((appt) =>
            multiCalendarState.visibleCompanies.includes(appt.companyId)
        ).length - maxDisplay;

    if (remainingCount > 0) {
        const overflow = document.createElement('div');
        overflow.className = 'appointment-indicator';
        overflow.textContent = `+${remainingCount} more`;
        overflow.style.fontSize = '9px';
        overflow.style.opacity = '0.7';
        appointmentsContainer.appendChild(overflow);
    }

    cell.appendChild(dayNumber);
    cell.appendChild(appointmentsContainer);

    cell.onclick = () => {
        multiCalendarState.selectedDate = new Date(date);
        renderMultiCompanyCalendar();
        renderDayDetails(dateKey);
    };

    return cell;
}

function getDayAppointments(dateKey) {
    const appointments = [];

    // Get appointments from the appointments object
    for (const apptId in state.appts) {
        const appt = state.appts[apptId];
        if (appt.dateKey === dateKey) {
            appointments.push(appt);
        }
    }

    // Get appointments from requests with holds
    state.requests.forEach((req) => {
        if (req.hold && req.hold.dateKey === dateKey) {
            appointments.push({
                companyId: req.hold.companyId,
                dateKey: req.hold.dateKey,
                startIdx: req.hold.startIdx,
                endIdx: req.hold.endIdx,
                status: 'TEMP',
                customerName: req.customer?.name || 'Unknown',
                email: req.customer?.email || '',
                serviceName: req.serviceName || 'Unknown Service'
            });
        }
    });

    // Sort by time
    appointments.sort((a, b) => a.startIdx - b.startIdx);

    return appointments;
}

function renderDayDetails(dateKey) {
    const titleEl = document.getElementById('selected-day-title');
    const summaryEl = document.getElementById('selected-day-summary');
    const appointmentsEl = document.getElementById('day-appointments');

    if (!titleEl || !summaryEl || !appointmentsEl) return;

    const date = parseDateKey(dateKey);
    const dayName = date.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
    });

    titleEl.textContent = dayName;

    const appointments = getDayAppointments(dateKey);
    const visibleAppointments = appointments.filter((appt) =>
        multiCalendarState.visibleCompanies.includes(appt.companyId)
    );

    summaryEl.textContent = `${visibleAppointments.length} appointment${
        visibleAppointments.length !== 1 ? 's' : ''
    }`;

    appointmentsEl.innerHTML = '';

    if (visibleAppointments.length === 0) {
        const noAppts = document.createElement('div');
        noAppts.className = 'no-selection';
        noAppts.textContent = 'Geen afspraken voor deze dag';
        appointmentsEl.appendChild(noAppts);
        return;
    }

    // Group by company
    const companiesWithAppts = {};
    COMPANIES.forEach((company) => {
        if (multiCalendarState.visibleCompanies.includes(company.id)) {
            companiesWithAppts[company.id] = {
                company,
                appointments: visibleAppointments.filter((appt) => appt.companyId === company.id)
            };
        }
    });

    Object.values(companiesWithAppts).forEach(({ company, appointments: companyAppts }) => {
        const companySection = document.createElement('div');
        companySection.className = `company-appointments company-${company.id}`;

        const header = document.createElement('h5');
        const icon = document.createElement('span');
        icon.className = 'company-icon';
        header.appendChild(icon);
        header.appendChild(document.createTextNode(company.name));
        companySection.appendChild(header);

        if (companyAppts.length === 0) {
            const noAppts = document.createElement('div');
            noAppts.className = 'no-appointments';
            noAppts.textContent = 'Geen afspraken';
            companySection.appendChild(noAppts);
        } else {
            companyAppts.forEach((appt) => {
                const apptEl = document.createElement('div');
                apptEl.className = 'appointment-item';

                const time = document.createElement('div');
                time.className = 'appointment-time';
                const startTime = minutesToHHMM(WORK_START * 60 + appt.startIdx * SLOT_MIN);
                const endTime = minutesToHHMM(WORK_START * 60 + appt.endIdx * SLOT_MIN);
                time.textContent = `${startTime} - ${endTime}`;

                const customer = document.createElement('div');
                customer.className = 'appointment-customer';
                customer.textContent = appt.customerName || 'Onbekende Klant';

                const status = document.createElement('span');
                status.className = `appointment-status ${appt.status.toLowerCase()}`;
                status.textContent = getStatusLabel(appt.status);

                apptEl.appendChild(time);
                apptEl.appendChild(customer);
                if (appt.serviceName) {
                    const service = document.createElement('div');
                    service.style.fontSize = '11px';
                    service.style.color = 'var(--sub)';
                    service.textContent = appt.serviceName;
                    apptEl.appendChild(service);
                }
                apptEl.appendChild(status);

                companySection.appendChild(apptEl);
            });
        }

        appointmentsEl.appendChild(companySection);
    });
}

function toggleCompanyFilter(companyId) {
    const index = multiCalendarState.visibleCompanies.indexOf(companyId);
    if (index > -1) {
        multiCalendarState.visibleCompanies.splice(index, 1);
    } else {
        multiCalendarState.visibleCompanies.push(companyId);
    }

    renderMultiCompanyCalendar();
    if (multiCalendarState.selectedDate) {
        renderDayDetails(formatDateKey(multiCalendarState.selectedDate));
    }
}

function refreshMultiCalendarIfActive() {
    if (state.currentPage === 'multi-calendar') {
        renderMultiCompanyCalendar();
        if (multiCalendarState.selectedDate) {
            renderDayDetails(formatDateKey(multiCalendarState.selectedDate));
        }
    }
}

function switchPage(p) {
    state.currentPage = p;
    saveState();
    document.getElementById('nav-admin').classList.toggle('active', p === 'admin');
    document.getElementById('nav-client').classList.toggle('active', p === 'client');
    document
        .getElementById('nav-multi-calendar')
        .classList.toggle('active', p === 'multi-calendar');
    document.getElementById('page-admin').style.display = p === 'admin' ? 'block' : 'none';
    document.getElementById('page-client').style.display = p === 'client' ? 'block' : 'none';
    document.getElementById('page-multi-calendar').style.display =
        p === 'multi-calendar' ? 'block' : 'none';

    // Initialize multi-company calendar if switching to it
    if (p === 'multi-calendar') {
        multiCalendarState.cursor = new Date(state.monthCursor);
        renderMultiCompanyCalendar();
        // Clear day details
        const appointmentsEl = document.getElementById('day-appointments');
        if (appointmentsEl) {
            appointmentsEl.innerHTML =
                '<div class="no-selection">Click on a calendar day to see appointments for all companies</div>';
        }
    }

    // Close sidebar on mobile when switching pages
    if (window.innerWidth <= 900) {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.classList.remove('open');
        }
    }
}

// --- Sidebar Combined Calendar ---
function renderSidebarMonth() {
    const wrap = document.getElementById('sidebar-month');
    if (!wrap) return;

    wrap.innerHTML = '';
    const d = new Date(state.monthCursor.getFullYear(), state.monthCursor.getMonth(), 1);
    const year = d.getFullYear();
    const month = d.getMonth();
    const monthName = d.toLocaleString(undefined, { month: 'short', year: 'numeric' });

    const header = document.createElement('header');
    const prev = document.createElement('button');
    prev.textContent = '‹';
    prev.onclick = () => {
        state.monthCursor.setMonth(state.monthCursor.getMonth() - 1);
        renderSidebarMonth();
        renderMonth();
        saveState();
    };
    const next = document.createElement('button');
    next.textContent = '›';
    next.onclick = () => {
        state.monthCursor.setMonth(state.monthCursor.getMonth() + 1);
        renderSidebarMonth();
        renderMonth();
        saveState();
    };
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = monthName;
    header.append(prev, title, next);

    const dow = document.createElement('div');
    dow.className = 'sidebar-dow';
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((d) => {
        const cell = document.createElement('div');
        cell.textContent = d;
        dow.appendChild(cell);
    });

    const days = document.createElement('div');
    days.className = 'sidebar-days';
    const firstDow = (d.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Empty cells for previous month
    for (let i = 0; i < firstDow; i++) {
        const prevDate = new Date(year, month, i - firstDow + 1);
        const cell = sidebarDayCell(prevDate, true);
        days.appendChild(cell);
    }

    // Days of current month
    for (let i = 1; i <= daysInMonth; i++) {
        const date = new Date(year, month, i);
        const cell = sidebarDayCell(date, false);
        days.appendChild(cell);
    }

    // Empty cells for next month
    const totalCells = firstDow + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= trailing; i++) {
        const nextDate = new Date(year, month + 1, i);
        const cell = sidebarDayCell(nextDate, true);
        days.appendChild(cell);
    }

    wrap.append(header, dow, days);
}

function sidebarDayCell(date, isOut) {
    const dateKey = formatDateKey(date);
    const cell = document.createElement('div');
    cell.className = 'sidebar-day' + (isOut ? ' out' : '');

    if (formatDateKey(state.selectedDate) === dateKey) {
        cell.classList.add('selected');
    }

    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = date.getDate();

    const indicators = document.createElement('div');
    indicators.className = 'company-indicators';

    // Get status for each company
    COMPANIES.forEach((company) => {
        const bar = document.createElement('div');
        bar.className = 'company-bar';

        // Ensure day exists for this company
        if (!state.schedule[company.id]) {
            state.schedule[company.id] = {};
        }
        if (!state.schedule[company.id][dateKey]) {
            ensureDay(dateKey, company.id);
        }

        const slots = state.schedule[company.id][dateKey];
        const hasBooked = slots.includes('BOOKED');
        const hasTemp = slots.includes('TEMP');

        if (hasBooked) {
            bar.style.background = '#ef4444'; // Red for booked
        } else if (hasTemp) {
            bar.style.background = '#9ca3af'; // Gray for temp
        } else {
            bar.style.background = '#22c55e'; // Green for available
        }

        // Add company color as border
        bar.style.border = `1px solid ${company.color}`;
        bar.style.borderRadius = '1px';

        indicators.appendChild(bar);
    });

    cell.appendChild(num);
    cell.appendChild(indicators);

    cell.onclick = () => {
        state.selectedDate = new Date(date);
        syncDatePicker();
        renderDay();
        renderSidebarMonth();
        saveState();
    };

    return cell;
}

// --- Tiny Test Suite (console) ---
// function runTests() {
//     // console.groupCollapsed('Demo Tests');
//     // 1) ensureDay creates correct number of slots
//     const testKey = '2099-12-31';
//     ensureDay(testKey);
//     const expectedSlots = ((WORK_END - WORK_START) * 60) / SLOT_MIN;
//     // console.assert(state.schedule[testKey].length === expectedSlots, 'ensureDay slot count');

//     // 2) getFreeWindows excludes BOOKED/TEMP
//     const slots = state.schedule[testKey];
//     for (let i = 0; i < slots.length; i++) slots[i] = 'FREE';
//     slots[2] = 'BOOKED';
//     slots[3] = 'TEMP';
//     const wins = getFreeWindows(testKey, 2);
//     const overlap = wins.some(
//         (w) => (w.startIdx <= 2 && w.endIdx > 2) || (w.startIdx <= 3 && w.endIdx > 3)
//     );
//     console.assert(!overlap, 'getFreeWindows should not include windows overlapping BOOKED/TEMP');

//     // 3) price calculator for S1
//     const p = SERVICES[0].price({
//         location: 'Toilet',
//         severity: 'Fully blocked',
//         afterHours: true
//     });
//     console.assert(p === 95 + 20 + 40 + 60, 'price formula S1');

//     // 4) releaseHold frees TEMP
//     const req = { hold: { dateKey: testKey, startIdx: 5, endIdx: 7 } };
//     for (let i = 5; i < 7; i++) slots[i] = 'TEMP';
//     releaseHold(req);
//     console.assert(
//         slots[5] === 'FREE' && slots[6] === 'FREE' && !req.hold,
//         'releaseHold frees and clears hold'
//     );

//     console.log('All tests executed. Check assertions above.');
//     console.groupEnd();
// }

// --- Theme Management ---
function initTheme() {
    // Load saved theme or default to dark
    const savedTheme = localStorage.getItem('plumberDemoTheme') || 'dark';
    applyTheme(savedTheme);

    // Set up theme switcher button
    const themeSwitcher = document.getElementById('theme-switcher');
    if (themeSwitcher) {
        themeSwitcher.addEventListener('click', toggleTheme);
        updateThemeIcon(savedTheme);
    }
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    updateThemeIcon(newTheme);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('plumberDemoTheme', theme);
}

function updateThemeIcon(theme) {
    const themeSwitcher = document.getElementById('theme-switcher');
    if (themeSwitcher) {
        themeSwitcher.textContent = theme === 'dark' ? '☀️' : '🌙';
        themeSwitcher.setAttribute(
            'aria-label',
            `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`
        );
    }
}

// --- Bootstrap ---
function init() {
    // Initialize company schedules
    COMPANIES.forEach((company) => {
        if (!state.schedule[company.id]) {
            state.schedule[company.id] = {};
        }
    });

    const had = loadState();
    // Seed demo data for both companies if first run
    if (!had) {
        const todayKey = formatDateKey(state.selectedDate);

        // Seed data for each company
        COMPANIES.forEach((company, index) => {
            ensureDay(todayKey, company.id);

            // Seed BOOKED appointment for each company at different times
            const bookedStart = ((10 + index * 2) * 60 - WORK_START * 60) / SLOT_MIN; // 10:00 for C1, 12:00 for C2
            const bookedEnd = bookedStart + 2;
            for (let i = bookedStart; i < bookedEnd; i++)
                state.schedule[company.id][todayKey][i] = 'BOOKED';
            const seedApptId = state.nextApptId++;
            state.appts[seedApptId] = {
                companyId: company.id,
                companyName: company.name,
                dateKey: todayKey,
                startIdx: bookedStart,
                endIdx: bookedEnd,
                status: 'CONFIRMED',
                client: { name: `Demo Client ${index + 1}`, email: `demo${index + 1}@example.com` },
                serviceName: 'Demo Job'
            };

            // Seed a TEMP hold for each company
            const tempStart = ((14 + index * 2) * 60 - WORK_START * 60) / SLOT_MIN; // 14:00 for C1, 16:00 for C2
            const tempEnd = tempStart + 1;
            for (let i = tempStart; i < tempEnd; i++)
                state.schedule[company.id][todayKey][i] = 'TEMP';
            const seedReq = {
                id: state.nextRequestId++,
                createdAt: Date.now(),
                customer: {
                    name: `Temp Client ${index + 1}`,
                    email: `temp${index + 1}@example.com`
                },
                serviceId: 'S1',
                serviceName: 'Blockage / Verstopping',
                answers: {},
                estimate: 95,
                preferred: {
                    dateKey: todayKey,
                    startIdx: tempStart,
                    endIdx: tempEnd,
                    startHHMM: minutesToHHMM(WORK_START * 60 + tempStart * SLOT_MIN),
                    endHHMM: minutesToHHMM(WORK_START * 60 + tempEnd * SLOT_MIN)
                },
                availableCompanies: [company.id],
                hold: {
                    dateKey: todayKey,
                    startIdx: tempStart,
                    endIdx: tempEnd,
                    companyId: company.id
                },
                status: 'NEW'
            };
            state.requests.unshift(seedReq);
        });

        saveState();
    }

    // Set up company selector
    const companySelect = document.getElementById('companySelect');
    if (companySelect) {
        companySelect.value = state.selectedCompanyId;
        companySelect.addEventListener('change', (e) => {
            state.selectedCompanyId = e.target.value;
            renderMonth();
            renderSidebarMonth();
            renderDay();
            saveState();
        });
    }

    // Admin widgets
    buildTimeOptions();
    syncDatePicker();
    renderMonth();
    renderSidebarMonth();
    renderDay();
    renderMail();
    renderRequests();

    // Client widgets
    populateServiceSelect();
    const cdate = document.getElementById('c_date');
    if (cdate) {
        cdate.value = formatDateKey(new Date());
    }
    renderClientTimes();
    updateClientUI();

    // Events
    const dp = document.getElementById('datePicker');
    if (dp) {
        dp.addEventListener('change', (e) => {
            state.selectedDate = parseDateKey(e.target.value);
            renderMonth();
            renderSidebarMonth();
            renderDay();
            saveState();
        });
    }
    const btnHold = document.getElementById('btnHold');
    if (btnHold) btnHold.onclick = onHoldClick;
    const btnBookFinal = document.getElementById('btnBookFinal');
    if (btnBookFinal) btnBookFinal.onclick = onBookFinalClick;
    const btnReset = document.getElementById('btnResetDay');
    if (btnReset) btnReset.onclick = onResetDay;
    const btnWeeklyAvailability = document.getElementById('btnWeeklyAvailability');
    if (btnWeeklyAvailability) btnWeeklyAvailability.onclick = showWeeklyAvailabilityPopup;

    document.getElementById('nav-admin').onclick = () => switchPage('admin');
    document.getElementById('nav-client').onclick = () => switchPage('client');
    document.getElementById('nav-multi-calendar').onclick = () => switchPage('multi-calendar');
    const btnClear = document.getElementById('btnClear');
    if (btnClear) btnClear.onclick = clearAllData;

    // Multi-company calendar controls
    const mcPrevBtn = document.getElementById('mc-prev-month');
    const mcNextBtn = document.getElementById('mc-next-month');
    if (mcPrevBtn) {
        mcPrevBtn.onclick = () => {
            multiCalendarState.cursor.setMonth(multiCalendarState.cursor.getMonth() - 1);
            renderMultiCompanyCalendar();
        };
    }
    if (mcNextBtn) {
        mcNextBtn.onclick = () => {
            multiCalendarState.cursor.setMonth(multiCalendarState.cursor.getMonth() + 1);
            renderMultiCompanyCalendar();
        };
    }

    // Company filter checkboxes
    ['C1', 'C2'].forEach((companyId) => {
        const checkbox = document.getElementById(`filter-${companyId}`);
        if (checkbox) {
            checkbox.addEventListener('change', () => toggleCompanyFilter(companyId));
        }
    });

    // Sidebar toggle functionality
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.querySelector('.sidebar');
    if (sidebarToggle && sidebar) {
        sidebarToggle.onclick = () => {
            sidebar.classList.toggle('open');
        };

        // Close sidebar when clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (
                window.innerWidth <= 900 &&
                !sidebar.contains(e.target) &&
                !sidebarToggle.contains(e.target) &&
                sidebar.classList.contains('open')
            ) {
                sidebar.classList.remove('open');
            }
        });
    }

    // Initialize theme switcher
    initTheme();

    const sSel = document.getElementById('c_service');
    if (sSel) {
        sSel.onchange = (e) => {
            state.clientSelection.serviceId = e.target.value || null;
            renderQuestions();
            renderClientTimes();
            saveState();
        };
    }
    const cdate2 = document.getElementById('c_date');
    if (cdate2) {
        cdate2.onchange = () => {
            renderClientTimes();
        };
    }
    document.getElementById('c_name').addEventListener('input', updateClientUI);
    document.getElementById('c_email').addEventListener('input', updateClientUI);
    const sendBtn = document.getElementById('c_send');
    if (sendBtn) {
        sendBtn.onclick = sendClientRequest;
    }

    // Restore page
    switchPage(state.currentPage || 'admin');

    // Initialize timer for periodic cleanup of expired appointments
    if (state.timerInterval) {
        clearInterval(state.timerInterval);
    }

    // Check for expired appointments every 10 seconds
    state.timerInterval = setInterval(() => {
        cleanupExpiredAppointments();
        // Refresh mail display to update timers
        renderMail();
        // Refresh day display to update slot timers
        if (state.currentPage === 'admin') {
            renderDay();
        }
    }, 10000);

    // Initial cleanup on startup
    cleanupExpiredAppointments();

    // Run tests (console)
    // runTests();
}

init();
