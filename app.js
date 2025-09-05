// --- Config ---
const WORK_START = 8; // 08:00
const WORK_END = 18; // 18:00
const SLOT_MIN = 30; // 30-min slots
const STORAGE_KEY = 'plumberDemoState_v4';

// Demo companies
const COMPANIES = [
    { id: 'C1', name: 'Quick Fix Plumbing', color: '#22c55e' },
    { id: 'C2', name: 'Professional Drain Services', color: '#3b82f6' },
    { id: 'C3', name: 'Emergency Plumbing 24/7', color: '#f59e0b' }
];

// Demo services catalog
const SERVICES = [
    {
        id: 'S1',
        name: 'Blockage / Verstopping',
        type: 'EASY',
        durationSlots: 2, // 60m
        base: 95,
        questions: [
            {
                key: 'location',
                label: 'Location',
                type: 'select',
                options: ['Kitchen', 'Bathroom', 'Toilet']
            },
            {
                key: 'severity',
                label: 'Severity',
                type: 'select',
                options: ['Slow drain', 'Fully blocked']
            },
            { key: 'afterHours', label: 'After-hours?', type: 'boolean' }
        ],
        price: (ans) => {
            let p = 95; // base
            if (ans.severity === 'Fully blocked') p += 40;
            if (ans.location === 'Toilet') p += 20;
            if (ans.afterHours === true) p += 60;
            return p;
        }
    },
    {
        id: 'S2',
        name: 'Bathroom Renovation (Quotation)',
        type: 'COMPLEX',
        durationSlots: 4, // 2h site visit slot (demo)
        base: 0,
        questions: [
            { key: 'area', label: 'Approx. bathroom size (m²)', type: 'number' },
            { key: 'shower', label: 'Shower?', type: 'boolean' },
            { key: 'bathtub', label: 'Bathtub?', type: 'boolean' }
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
function minutesToHHMM(min) {
    const h = Math.floor(min / 60),
        m = min % 60;
    return `${('' + h).padStart(2, '0')}:${('' + m).padStart(2, '0')}`;
}
function hhmmToMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

// --- State ---
const state = {
    monthCursor: new Date(),
    selectedDate: new Date(),
    selectedCompanyId: 'C1', // Default to first company
    schedule: {}, // companyId -> dateKey -> ['FREE'|'TEMP'|'BOOKED']
    emails: [], // {id, subj, body, apptId, status, to}
    appts: {}, // apptId -> {companyId,dateKey,startIdx,endIdx,status}
    requests: [], // array of request objects (client → admin)
    nextApptId: 1,
    nextEmailId: 1,
    nextRequestId: 1,
    currentPage: 'admin',
    clientSelection: { serviceId: null, dateKey: null, startIdx: null, endIdx: null }
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
    prev.textContent = '‹ Prev';
    prev.onclick = () => {
        state.monthCursor = new Date(year, month - 1, 1);
        renderMonth();
        saveState();
    };
    const next = document.createElement('button');
    next.textContent = 'Next ›';
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
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d) => {
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
    if (!hasBooked && !hasTemp) {
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
        timeDiv.textContent = minutesToHHMM(slotMin);

        const slotDiv = document.createElement('div');
        slotDiv.className = `slot ${slots[i]}`;

        // Find appointment info for this slot
        const apptInfo = findAppointmentInfo(dateKey, i);
        let displayText = slots[i];

        if (slots[i] === 'BOOKED' || slots[i] === 'TEMP') {
            let customerName = 'Unknown';
            let email = '';
            let shouldShowActions = false;

            if (apptInfo && apptInfo.type === 'appointment') {
                customerName = apptInfo.data.customerName || 'Unknown';
                email = apptInfo.data.email || '';
                shouldShowActions = true;
            } else if (apptInfo && apptInfo.type === 'request') {
                customerName = apptInfo.data.customer.name || 'Unknown';
                email = apptInfo.data.customer.email || '';
                shouldShowActions = true;
            }

            displayText = `${slots[i]} - ${customerName}`;

            if (shouldShowActions) {
                // Add action buttons for booked/temp slots
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'slot-actions';
                actionsDiv.style.cssText = 'display: flex; gap: 4px; margin-left: auto;';

                // WhatsApp button
                const whatsappBtn = document.createElement('button');
                whatsappBtn.innerHTML = '📱';
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
                emailBtn.innerHTML = '📧';
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
        content = `
      <div class="popup-row">
        <span class="popup-label">Status:</span>
        <span class="popup-value">${appt.status}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Company:</span>
        <span class="popup-value">${appt.companyName || 'Unknown Company'}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Customer:</span>
        <span class="popup-value">${customerName}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Email:</span>
        <span class="popup-value">${email}</span>
      </div>
      ${
          appt.serviceName
              ? `<div class="popup-row"><span class="popup-label">Service:</span><span class="popup-value">${appt.serviceName}</span></div>`
              : ''
      }
      <div class="popup-row">
        <span class="popup-label">Date:</span>
        <span class="popup-value">${dateKey}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Time:</span>
        <span class="popup-value">${startTime} - ${endTime}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Duration:</span>
        <span class="popup-value">${(appt.endIdx - appt.startIdx) * SLOT_MIN} minutes</span>
      </div>
      <div style="margin-top: 16px; display: flex; gap: 8px;">
        <button class="btn" onclick="
          const phone = prompt('Enter phone number for ${customerName}:');
          if (phone) {
            const message = encodeURIComponent('Hi ${customerName}, regarding your appointment on ${dateKey} at ${startTime}');
            window.open('https://wa.me/' + phone + '?text=' + message, '_blank');
          }
        ">📱 WhatsApp</button>
        <button class="btn" onclick="
          const subject = encodeURIComponent('Appointment - ${dateKey}');
          const body = encodeURIComponent('Hi ${customerName},\\n\\nRegarding your appointment on ${dateKey} at ${startTime}.\\n\\nBest regards,\\nPlumber Service');
          window.open('mailto:${email}?subject=' + subject + '&body=' + body, '_blank');
        ">📧 Email</button>
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
        ">📱 WhatsApp</button>
        <button class="btn" onclick="
          const subject = encodeURIComponent('Service Request - ${req.serviceName}');
          const body = encodeURIComponent('Hi ${
              req.customer.name
          },\\n\\nRegarding your service request for ${
            req.serviceName
        }.\\n\\nBest regards,\\nPlumber Service');
          window.open('mailto:${
              req.customer.email
          }?subject=' + subject + '&body=' + body, '_blank');
        ">📧 Email</button>
      </div>
    `;
    } else {
        title = `${slotStatus} Slot`;
        content = `
      <div class="popup-row">
        <span class="popup-label">Date:</span>
        <span class="popup-value">${dateKey}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Time:</span>
        <span class="popup-value">${minutesToHHMM(WORK_START * 60 + slotIndex * SLOT_MIN)}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Status:</span>
        <span class="popup-value">${slotStatus}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Info:</span>
        <span class="popup-value">No appointment details found</span>
      </div>
    `;
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
        empty.textContent = 'No messages yet — create a temp appointment to send an email.';
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
            const actions = document.createElement('div');
            actions.className = 'actions';
            const ok = document.createElement('button');
            ok.className = 'btn approve';
            ok.textContent = 'Approve';
            ok.onclick = () => confirmAppointment(m.apptId);
            const rej = document.createElement('button');
            rej.className = 'btn reject';
            rej.textContent = 'Reject';
            rej.onclick = () => rejectAppointment(m.apptId);
            actions.append(ok, rej);
            card.appendChild(actions);
        } else if (appt) {
            const info = document.createElement('div');
            info.className = 'meta';
            info.textContent = `Status: ${appt.status}`;
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
    if (endIdx <= startIdx) return alert('Invalid time range');
    for (let i = startIdx; i < endIdx; i++) {
        if (slots[i] !== 'FREE') return alert('Time slot not available');
    }
    for (let i = startIdx; i < endIdx; i++) slots[i] = 'TEMP';
    const id = state.nextApptId++;
    const company = COMPANIES.find((c) => c.id === cId);
    const appt = {
        companyId: cId,
        companyName: company ? company.name : 'Unknown Company',
        dateKey,
        startIdx,
        endIdx,
        status: 'TEMP',
        email: email || 'client@example.com',
        customerName: customerName || 'Unknown Client'
    };
    if (email && email.includes('@')) appt.email = email;
    state.appts[id] = appt;
    renderDay();
    renderMonth();
    saveState();

    const subj = `Your appointment is temporarily reserved – please confirm`;
    const body = `<p>Thanks for your request.</p>
<p><strong>Company:</strong> ${appt.companyName}<br/>
<strong>Date:</strong> ${dateKey}<br/>
<strong>Time:</strong> ${startHHMM}–${endHHMM}</p>
<p>This booking is <em>temporary</em>. Please Approve or Reject below.</p>`;
    pushEmail({ subj, body, apptId: id, to: email || 'client@example.com' });
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
    if (endIdx <= startIdx) return alert('Invalid time range');
    for (let i = startIdx; i < endIdx; i++) {
        if (slots[i] !== 'FREE') return alert('Time slot not available');
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
        email: email || 'client@example.com',
        customerName: customerName || 'Unknown Client'
    };
    state.appts[id] = appt;
    renderDay();
    renderMonth();
    saveState();

    const subj = `Your appointment is confirmed`;
    const body = `<p>Your appointment has been confirmed!</p>
<p><strong>Company:</strong> ${appt.companyName}<br/>
<strong>Date:</strong> ${dateKey}<br/>
<strong>Time:</strong> ${startHHMM}–${endHHMM}</p>
<p>We look forward to seeing you.</p>`;
    pushEmail({ subj, body, apptId: id, to: email || 'client@example.com' });
    return id;
}

function confirmAppointment(apptId) {
    const appt = state.appts[apptId];
    if (!appt) return;
    const slots = state.schedule[appt.companyId][appt.dateKey];
    for (let i = appt.startIdx; i < appt.endIdx; i++) slots[i] = 'BOOKED';
    appt.status = 'CONFIRMED';
    renderDay();
    renderMonth();
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
    renderMail();
    saveState();
}

// --- Requests (Admin) ---
function renderRequests() {
    const list = document.getElementById('requestList');
    if (!list) return;
    list.innerHTML = '';
    if (state.requests.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'note';
        empty.textContent = 'No requests yet.';
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
        companyLabel.textContent = 'Assign to Company: ';
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
        btnPropReq.textContent = 'Propose Requested Time';
        btnPropReq.onclick = () => {
            if (!req.preferred?.dateKey) {
                alert('No preferred time selected by client.');
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
        btnProp.textContent = 'Propose Custom Time';
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
        btnReject.textContent = 'Reject Request';
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
        btnApprove.textContent = 'Approve';
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
    const appt = {
        companyId: companyId,
        companyName: company ? company.name : 'Unknown Company',
        dateKey,
        startIdx,
        endIdx,
        status: 'TEMP',
        email: email || 'client@example.com'
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

    const subj = `Your appointment is temporarily reserved – please confirm`;
    const body = `<p>Thanks for your request.</p>
<p><strong>Company:</strong> ${appt.companyName}<br/>
<strong>Date:</strong> ${dateKey}<br/>
<strong>Time:</strong> ${startHHMM}–${endHHMM}</p>
<p>This booking is <em>temporary</em>. Please Approve or Reject below.</p>`;
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
    sel.innerHTML = '<option value="">Select a service…</option>';
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
        el.textContent = 'Select a service…';
        return;
    }
    const ans = collectAnswers();
    const price = service.price(ans);
    if (price == null) {
        el.textContent = 'Quotation will be provided';
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
    if (!name) errs.push('Enter your name.');
    const email = document.getElementById('c_email').value.trim();
    if (!emailValid(email)) errs.push('Enter a valid email.');
    const serviceId = document.getElementById('c_service').value;
    if (!serviceId) errs.push('Select a service.');
    const qs = document.querySelectorAll('#c_questions [data-key]');
    qs.forEach((el) => {
        if (el.type === 'number') {
            if (el.value === '') errs.push(`Fill ${el.dataset.key}.`);
        } else if (el.tagName === 'SELECT' || el.tagName === 'INPUT') {
            if (el.value === '') errs.push(`Fill ${el.dataset.key}.`);
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
        grid.innerHTML = '<div class="note">No free slots on this day.</div>';
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
        showClientError('Please choose a date and time.');
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
        showClientError('Selected time is no longer available. Please pick another slot.');
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
    saveState();
}

function clearAllData() {
    if (confirm('Clear all demo data and reset?')) {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
    }
}

function switchPage(p) {
    state.currentPage = p;
    saveState();
    document.getElementById('nav-admin').classList.toggle('active', p === 'admin');
    document.getElementById('nav-client').classList.toggle('active', p === 'client');
    document.getElementById('page-admin').style.display = p === 'admin' ? 'block' : 'none';
    document.getElementById('page-client').style.display = p === 'client' ? 'block' : 'none';

    // Close sidebar on mobile when switching pages
    if (window.innerWidth <= 900) {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.classList.remove('open');
        }
    }
}

// --- Tiny Test Suite (console) ---
function runTests() {
    console.groupCollapsed('Demo Tests');
    // 1) ensureDay creates correct number of slots
    const testKey = '2099-12-31';
    ensureDay(testKey);
    const expectedSlots = ((WORK_END - WORK_START) * 60) / SLOT_MIN;
    console.assert(state.schedule[testKey].length === expectedSlots, 'ensureDay slot count');

    // 2) getFreeWindows excludes BOOKED/TEMP
    const slots = state.schedule[testKey];
    for (let i = 0; i < slots.length; i++) slots[i] = 'FREE';
    slots[2] = 'BOOKED';
    slots[3] = 'TEMP';
    const wins = getFreeWindows(testKey, 2);
    const overlap = wins.some(
        (w) => (w.startIdx <= 2 && w.endIdx > 2) || (w.startIdx <= 3 && w.endIdx > 3)
    );
    console.assert(!overlap, 'getFreeWindows should not include windows overlapping BOOKED/TEMP');

    // 3) price calculator for S1
    const p = SERVICES[0].price({
        location: 'Toilet',
        severity: 'Fully blocked',
        afterHours: true
    });
    console.assert(p === 95 + 20 + 40 + 60, 'price formula S1');

    // 4) releaseHold frees TEMP
    const req = { hold: { dateKey: testKey, startIdx: 5, endIdx: 7 } };
    for (let i = 5; i < 7; i++) slots[i] = 'TEMP';
    releaseHold(req);
    console.assert(
        slots[5] === 'FREE' && slots[6] === 'FREE' && !req.hold,
        'releaseHold frees and clears hold'
    );

    console.log('All tests executed. Check assertions above.');
    console.groupEnd();
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
    // Seed a couple of slots if first run
    if (!had) {
        const todayKey = formatDateKey(state.selectedDate);
        ensureDay(todayKey);
        // Seed BOOKED 10:00–11:00 and create an appointment record
        const bookedStart = (10 * 60 - WORK_START * 60) / SLOT_MIN;
        const bookedEnd = bookedStart + 2;
        for (let i = bookedStart; i < bookedEnd; i++)
            state.schedule[state.selectedCompanyId][todayKey][i] = 'BOOKED';
        const seedApptId = state.nextApptId++;
        const company = COMPANIES.find((c) => c.id === state.selectedCompanyId);
        state.appts[seedApptId] = {
            companyId: state.selectedCompanyId,
            companyName: company ? company.name : 'Unknown Company',
            dateKey: todayKey,
            startIdx: bookedStart,
            endIdx: bookedEnd,
            status: 'CONFIRMED',
            client: { name: 'Seeded Client', email: 'seed@example.com' },
            serviceName: 'Demo Job'
        };

        // Seed a TEMP hold 15:00–15:30 with a matching request
        const tempStart = (15 * 60 - WORK_START * 60) / SLOT_MIN;
        const tempEnd = tempStart + 1;
        for (let i = tempStart; i < tempEnd; i++)
            state.schedule[state.selectedCompanyId][todayKey][i] = 'TEMP';
        const seedReq = {
            id: state.nextRequestId++,
            createdAt: Date.now(),
            customer: { name: 'Demo Client', email: 'demo@example.com' },
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
            availableCompanies: [state.selectedCompanyId],
            hold: {
                dateKey: todayKey,
                startIdx: tempStart,
                endIdx: tempEnd,
                companyId: state.selectedCompanyId
            },
            status: 'NEW'
        };
        state.requests.unshift(seedReq);
        saveState();
    }

    // Set up company selector
    const companySelect = document.getElementById('companySelect');
    if (companySelect) {
        companySelect.value = state.selectedCompanyId;
        companySelect.addEventListener('change', (e) => {
            state.selectedCompanyId = e.target.value;
            renderMonth();
            renderDay();
            saveState();
        });
    }

    // Admin widgets
    buildTimeOptions();
    syncDatePicker();
    renderMonth();
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

    document.getElementById('nav-admin').onclick = () => switchPage('admin');
    document.getElementById('nav-client').onclick = () => switchPage('client');
    const btnClear = document.getElementById('btnClear');
    if (btnClear) btnClear.onclick = clearAllData;

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

    // Run tests (console)
    runTests();
}

init();
