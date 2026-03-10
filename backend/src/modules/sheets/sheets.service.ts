// ============================================================
// ALFA — Google Sheets Bidirectional Sync Service
// File: backend/src/modules/sheets/sheets.service.ts
// ============================================================

import { google }        from 'googleapis';
import { db }            from '../../config/database';
import { indexFromSheet } from '../ai/rag.service';
import { logger }         from '../../utils/logger';

// ─── AUTH: Get authorized Sheets client for a tenant ─────────
async function getSheetsClient(tenantId: string) {
  const tenant = await db.tenant.findUnique({
    where:   { id: tenantId },
    include: { google_credentials: true }
  });

  if (!tenant?.google_credentials) {
    throw new Error(`No Google credentials for tenant ${tenantId}`);
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email:  tenant.google_credentials.client_email,
      private_key:   tenant.google_credentials.private_key,
    },
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly'
    ]
  });

  return {
    sheets: google.sheets({ version: 'v4', auth }),
    sheetId: tenant.google_sheet_id
  };
}

// ─── READ: Get all data from a sheet tab ─────────────────────
export async function readSheet(
  tenantId: string,
  tabName:  string,
  range:    string = 'A:Z'
): Promise<any[][]> {
  const { sheets, sheetId } = await getSheetsClient(tenantId);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId!,
    range:         `${tabName}!${range}`
  });

  return res.data.values || [];
}

// ─── WRITE: Append a new row to a sheet tab ──────────────────
export async function appendRow(
  tenantId: string,
  tabName:  string,
  rowData:  any[]
): Promise<{ updatedRange: string }> {
  const { sheets, sheetId } = await getSheetsClient(tenantId);

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId:     sheetId!,
    range:             `${tabName}!A:Z`,
    valueInputOption:  'USER_ENTERED',
    insertDataOption:  'INSERT_ROWS',
    requestBody: { values: [rowData] }
  });

  const updatedRange = res.data.updates?.updatedRange || '';
  logger.info(`Appended row to ${tabName} for tenant ${tenantId}: ${updatedRange}`);
  return { updatedRange };
}

// ─── UPDATE: Update a specific row by row number ─────────────
export async function updateRow(
  tenantId:  string,
  tabName:   string,
  rowNumber: number,
  rowData:   any[]
): Promise<void> {
  const { sheets, sheetId } = await getSheetsClient(tenantId);

  await sheets.spreadsheets.values.update({
    spreadsheetId:    sheetId!,
    range:            `${tabName}!A${rowNumber}:Z${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody:      { values: [rowData] }
  });
}

// ─── SAVE ORDER TO SHEETS ─────────────────────────────────────
export async function saveOrderToSheet(tenantId: string, order: {
  orderId:       string;
  customerName:  string;
  customerPhone: string;
  items:         string;
  quantity:      string;
  total:         number;
  address:       string;
  status:        string;
}): Promise<void> {
  const row = [
    order.orderId,
    new Date().toLocaleString('en-IN'),
    order.customerName,
    order.customerPhone,
    order.items,
    order.quantity,
    `₹${order.total}`,
    order.address,
    order.status,
    '' // Notes column — admin can fill manually
  ];

  await appendRow(tenantId, 'Orders', row);

  // Also save to our DB
  await db.order.create({
    data: {
      tenant_id:      tenantId,
      order_number:   order.orderId,
      customer_phone: order.customerPhone,
      customer_name:  order.customerName,
      items_summary:  order.items,
      total_amount:   order.total,
      status:         'confirmed',
      delivery_addr:  order.address
    }
  });
}

// ─── SAVE APPOINTMENT TO SHEETS ───────────────────────────────
export async function saveAppointmentToSheet(tenantId: string, appt: {
  apptId:        string;
  customerName:  string;
  customerPhone: string;
  service:       string;
  date:          string;
  time:          string;
  notes:         string;
}): Promise<void> {
  const row = [
    appt.apptId,
    new Date().toLocaleString('en-IN'),
    appt.customerName,
    appt.customerPhone,
    appt.service,
    appt.date,
    appt.time,
    'Confirmed',
    appt.notes
  ];

  await appendRow(tenantId, 'Appointments', row);

  // Save to DB and schedule reminder
  const appointment = await db.appointment.create({
    data: {
      tenant_id:      tenantId,
      appt_number:    appt.apptId,
      customer_phone: appt.customerPhone,
      customer_name:  appt.customerName,
      service:        appt.service,
      appt_date:      new Date(`${appt.date} ${appt.time}`),
      status:         'confirmed',
      notes:          appt.notes
    }
  });

  // Queue reminder jobs
  const { scheduleReminders } = await import('../../jobs/reminder.job');
  await scheduleReminders(appointment);
}

// ─── READ PRODUCTS FROM SHEET (for AI context) ───────────────
export async function syncProductsToAI(tenantId: string): Promise<void> {
  try {
    const rows = await readSheet(tenantId, 'Products');
    if (rows.length === 0) return;

    // Re-index the products sheet into tenant's ChromaDB collection
    await indexFromSheet(tenantId, rows, 'products_sheet_sync');
    logger.info(`Products synced to AI for tenant ${tenantId}: ${rows.length} rows`);
  } catch (err) {
    logger.error(`Products sync error for tenant ${tenantId}:`, err);
  }
}

// ─── CHECK APPOINTMENT AVAILABILITY ──────────────────────────
export async function checkAvailability(
  tenantId: string,
  date:     string,
  time:     string
): Promise<{ available: boolean; reason?: string }> {
  try {
    const rows = await readSheet(tenantId, 'Appointments');
    const headers = rows[0] || [];
    const dateCol = headers.findIndex((h: string) => h.toLowerCase().includes('date'));
    const timeCol = headers.findIndex((h: string) => h.toLowerCase().includes('time'));
    const statCol = headers.findIndex((h: string) => h.toLowerCase().includes('status'));

    const conflict = rows.slice(1).find(row =>
      row[dateCol] === date &&
      row[timeCol] === time &&
      row[statCol]?.toLowerCase() === 'confirmed'
    );

    return conflict
      ? { available: false, reason: 'That slot is already booked' }
      : { available: true };
  } catch (err) {
    return { available: true }; // Assume available if can't check
  }
}

// ─── SYNC SHEETS → AI (scheduled, every 30 minutes) ──────────
export async function syncToSheets(tenantId: string) {
  await syncProductsToAI(tenantId);
}
