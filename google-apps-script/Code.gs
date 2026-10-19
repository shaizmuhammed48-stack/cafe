/**
 * ============================================================================
 *  Mad Co Cafe — Google Apps Script backend
 * ============================================================================
 *
 *  Acts as the JSON API between the Next.js application and the Google Sheet.
 *
 *  Sheet tabs (exact names, lowercase, spaces included):
 *    "items list"  → A: id | B: category | C: name | D: image | E: stock | F: price (optional)
 *    "order list"  → A: order id | B: item id | C: quantity order | D: payment status
 *
 *  The configured names above always win. When a workbook uses a different
 *  spelling of the same tab (for example "Items" / "Items List"), the aliases
 *  listed in CONFIG below are tried as a fallback so a differently-cased tab
 *  does not take the whole menu offline. Column headers are never guessed: the
 *  letter-to-field mapping is fixed by CONFIG.COL and the README.
 *
 *  Endpoints (after deploying as a Web app, the URL ends in /exec):
 *
 *    GET   ?action=getInventory        → live inventory
 *    GET   ?action=getOrders           → order history
 *    GET   ?action=getAll              → inventory + order history in one call
 *    GET   ?action=ping                → health check
 *    POST  { action: "createOrder", items: [{ itemId, quantity }, ...] }
 *                                      → validates, deducts stock and appends
 *                                        the order rows inside one lock.
 *    POST  { action: "updatePaymentStatus", orderId, paymentStatus }
 *                                      → flips "pending"/"paid" for an order
 *
 *  Concurrency: every write runs inside LockService.getScriptLock(), so two
 *  simultaneous checkouts can never oversell the same product or duplicate an
 *  order id. All validation happens before the first cell is modified, and any
 *  write failure restores the original stock values.
 *
 *  ── CONFIGURATION ──────────────────────────────────────────────────────────
 *  Only one value needs to be changed: CONFIG.SPREADSHEET_ID (see below).
 */

var CONFIG = {
  /** Required: the id of your Google Sheet (the long string in its URL). */
  SPREADSHEET_ID: 'PASTE_YOUR_SPREADSHEET_ID_HERE',

  ITEMS_SHEET: 'items list',
  ORDERS_SHEET: 'order list',

  /*
   * Alternative spellings accepted for the two tabs above, tried only when the
   * configured name is missing. These come from the live deployment, which
   * reported: `Sheet not found. Expected one of: Items, Items List`. The
   * configured name is always preferred, so this never overrides ITEMS_SHEET /
   * ORDERS_SHEET. Leave the arrays empty to disable the fallback entirely.
   */
  ITEMS_SHEET_ALIASES: ['Items', 'Items List'],
  ORDERS_SHEET_ALIASES: ['Orders', 'Order List'],

  ORDER_PREFIX: 'OR',
  ORDER_ID_WIDTH: 3,

  LOCK_WAIT_MS: 30000,
  READ_LOCK_WAIT_MS: 5000,

  MAX_LINES_PER_ORDER: 50,
  MAX_QUANTITY: 10000,

  PAYMENT_STATUSES: ['pending', 'paid'],

  COL: {
    ITEM_ID: 1,        // A
    ITEM_CATEGORY: 2,  // B
    ITEM_NAME: 3,      // C
    ITEM_IMAGE: 4,     // D
    ITEM_STOCK: 5,     // E
    ITEM_PRICE: 6,     // F (optional — only used if the sheet has a price column)
    ORDER_ID: 1,       // A
    ORDER_ITEM_ID: 2,  // B
    ORDER_QTY: 3,      // C
    ORDER_STATUS: 4    // D
  }
};

/* ==========================================================================
 *  Entry points
 * ======================================================================== */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action) : 'getAll';

  // Share the script lock with writers so a read can never observe a
  // half-applied order. If a writer holds the lock we read anyway rather
  // than failing the request.
  var lock = null;
  var locked = false;
  try {
    lock = LockService.getScriptLock();
    lock.waitLock(CONFIG.READ_LOCK_WAIT_MS);
    locked = true;
  } catch (lockError) {
    locked = false;
  }

  try {
    switch (action) {
      case 'ping':
        return json_({ success: true, message: 'ok', time: new Date().toISOString() });
      case 'getInventory':
        return json_({ success: true, items: readItems_(openSpreadsheet_()), message: 'Inventory loaded.' });
      case 'getOrders':
        return json_({ success: true, orders: readOrders_(openSpreadsheet_()), message: 'Orders loaded.' });
      case 'getAll':
        var ss = openSpreadsheet_();
        return json_({
          success: true,
          items: readItems_(ss),
          orders: readOrders_(ss),
          message: 'Inventory and orders loaded.'
        });
      default:
        return json_({
          success: false,
          error: 'UNKNOWN_ACTION',
          message: 'Unknown action "' + action + '". Use getInventory, getOrders, getAll or ping.'
        });
    }
  } catch (error) {
    return json_(failure_(error));
  } finally {
    if (locked) {
      try { lock.releaseLock(); } catch (ignored) { /* already released */ }
    }
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;

  try {
    // ── Critical: serialise every mutation so stock cannot oversell. ──────
    lock.waitLock(CONFIG.LOCK_WAIT_MS);
    locked = true;

    var payload = parseBody_(e);
    if (!payload) {
      return json_({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Request body must be JSON, e.g. {"action":"createOrder","items":[...]}.'
      });
    }

    var action = payload.action ? String(payload.action) : '';

    if (action === 'createOrder') return createOrder_(payload);
    // `updatePayment` is the action name used by the deployed sheet script;
    // both spellings are accepted so either deployment works with the app.
    if (action === 'updatePaymentStatus' || action === 'updatePayment') {
      return updatePaymentStatus_(payload);
    }

    return json_({
      success: false,
      error: 'UNKNOWN_ACTION',
      message: 'Unknown action "' + action + '". Supported: createOrder, updatePaymentStatus, updatePayment.'
    });
  } catch (error) {
    if (isLockError_(error)) {
      return json_({
        success: false,
        error: 'LOCK_TIMEOUT',
        message: 'Another order is being processed right now. Please retry in a moment.'
      });
    }
    return json_(failure_(error));
  } finally {
    if (locked) {
      try { lock.releaseLock(); } catch (ignored) { /* already released */ }
    }
  }
}

/* ==========================================================================
 *  Order creation — validate everything, then write, then roll back on error
 * ======================================================================== */

function createOrder_(payload) {
  // ── Step 1: validate the raw request (no sheet access yet) ──────────────
  // Two payload shapes are accepted: the cart form { items: [...] } and the
  // single-line form { itemId, quantity } used by the deployed sheet script.
  var requestedLines = payload.items;
  if (!Array.isArray(requestedLines) && payload.itemId !== undefined) {
    requestedLines = [{ itemId: payload.itemId, quantity: payload.quantity }];
  }

  var validated = validateOrderLines_(requestedLines);
  if (!validated.ok) {
    return json_({ success: false, error: 'VALIDATION_ERROR', message: validated.message });
  }
  var lines = validated.lines;

  // ── Step 2: read the current state of the sheet ─────────────────────────
  var ss = openSpreadsheet_();
  var itemsSheet = getSheet_(ss, CONFIG.ITEMS_SHEET, CONFIG.ITEMS_SHEET_ALIASES);
  var ordersSheet = getSheet_(ss, CONFIG.ORDERS_SHEET, CONFIG.ORDERS_SHEET_ALIASES);
  var itemIndex = buildItemIndex_(itemsSheet);

  // ── Step 3: validate every requested line BEFORE touching any cell ──────
  var plan = [];
  var failures = [];
  var stockMap = {};

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var item = itemIndex[line.itemId];

    if (!item) {
      failures.push({
        itemId: line.itemId,
        code: 'UNKNOWN_ITEM',
        message: 'Item "' + line.itemId + '" does not exist in the "' + CONFIG.ITEMS_SHEET + '" tab.'
      });
      continue;
    }

    if (line.quantity <= 0) {
      failures.push({
        itemId: line.itemId,
        code: 'INVALID_QUANTITY',
        message: 'Quantity for "' + item.name + '" must be at least 1.'
      });
      continue;
    }

    if (line.quantity > item.stock) {
      failures.push({
        itemId: line.itemId,
        code: 'INSUFFICIENT_STOCK',
        message: item.name + ' only has ' + item.stock + ' in stock (requested ' + line.quantity + ').',
        requested: line.quantity,
        available: item.stock
      });
      continue;
    }

    if (stockMap[line.itemId] === undefined) stockMap[line.itemId] = 0;
    stockMap[line.itemId] += line.quantity;

    plan.push({
      row: item.row,
      name: item.name,
      itemId: line.itemId,
      quantity: line.quantity,
      stock: item.stock,
      newStock: item.stock - line.quantity
    });
  }

  if (failures.length > 0) {
    // Nothing has been written yet, so nothing needs to be rolled back.
    return json_({
      success: false,
      error: failures[0].code || 'VALIDATION_ERROR',
      message: failures.map(function (f) { return f.message; }).join(' '),
      details: failures
    });
  }

  // Consolidate repeated item ids (validation already rejects duplicates, this
  // keeps the deduction maths safe if that ever changes).
  var deductionByRow = {};
  for (var p = 0; p < plan.length; p++) {
    var step = plan[p];
    if (deductionByRow[step.row] === undefined) {
      deductionByRow[step.row] = {
        row: step.row,
        itemId: step.itemId,
        stock: step.stock,
        deduct: 0,
        name: step.name
      };
    }
    deductionByRow[step.row].deduct += step.quantity;
  }

  // ── Step 4: allocate a unique order id (max numeric suffix + 1) ─────────
  var orderId = nextOrderId_(ordersSheet);

  // ── Step 5: write stock deductions, then append the order rows ──────────
  var writtenStockRows = [];
  try {
    var rowKeys = Object.keys(deductionByRow);
    for (var k = 0; k < rowKeys.length; k++) {
      var entry = deductionByRow[rowKeys[k]];
      var newStock = entry.stock - entry.deduct;
      if (newStock < 0) throw new Error('Stock underflow for "' + entry.name + '".');
      itemsSheet.getRange(entry.row, CONFIG.COL.ITEM_STOCK).setValue(newStock);
      writtenStockRows.push({ row: entry.row, previous: entry.stock });
    }

    var orderRows = lines.map(function (line) {
      return [orderId, line.itemId, line.quantity, 'pending'];
    });

    var nextRow = ordersSheet.getLastRow() + 1;
    ordersSheet.getRange(nextRow, CONFIG.COL.ORDER_ID, orderRows.length, 4).setValues(orderRows);

    SpreadsheetApp.flush();
  } catch (writeError) {
    // ── Compensating action: never leave stock deducted without an order. ─
    for (var w = 0; w < writtenStockRows.length; w++) {
      var restore = writtenStockRows[w];
      itemsSheet.getRange(restore.row, CONFIG.COL.ITEM_STOCK).setValue(restore.previous);
    }
    SpreadsheetApp.flush();

    return json_({
      success: false,
      error: 'WRITE_FAILED',
      message: 'The order could not be saved, so no stock was deducted. ' +
        'Original values were restored. ' + String(writeError && writeError.message ? writeError.message : writeError)
    });
  }

  // ── Step 6: report the authoritative post-order stock ───────────────────
  var updatedStock = {};
  for (var stockId in stockMap) {
    if (!stockMap.hasOwnProperty(stockId)) continue;
    updatedStock[stockId] = itemIndex[stockId].stock - stockMap[stockId];
  }

  return json_({
    success: true,
    orderId: orderId,
    message: 'Order ' + orderId + ' confirmed. Stock updated in Google Sheets.',
    items: lines.map(function (line) {
      return { itemId: line.itemId, quantity: line.quantity };
    }),
    stock: updatedStock
  });
}

/* ==========================================================================
 *  Payment status update
 * ======================================================================== */

function updatePaymentStatus_(payload) {
  var orderId = payload.orderId ? String(payload.orderId).trim() : '';
  var status = payload.paymentStatus ? String(payload.paymentStatus).trim().toLowerCase() : '';

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(orderId)) {
    return json_({ success: false, error: 'VALIDATION_ERROR', message: 'A valid order id is required.' });
  }
  if (CONFIG.PAYMENT_STATUSES.indexOf(status) === -1) {
    return json_({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'paymentStatus must be one of: ' + CONFIG.PAYMENT_STATUSES.join(', ') + '.'
    });
  }

  var ss = openSpreadsheet_();
  var ordersSheet = getSheet_(ss, CONFIG.ORDERS_SHEET, CONFIG.ORDERS_SHEET_ALIASES);
  var lastRow = ordersSheet.getLastRow();

  if (lastRow < 2) {
    return json_({ success: false, error: 'ORDER_NOT_FOUND', message: 'No orders have been recorded yet.' });
  }

  var ids = ordersSheet.getRange(2, CONFIG.COL.ORDER_ID, lastRow - 1, 1).getValues();
  var targetRows = [];
  for (var i = 0; i < ids.length; i++) {
    var value = ids[i][0] === null ? '' : String(ids[i][0]).trim();
    if (value === orderId) targetRows.push(i + 2);
  }

  if (targetRows.length === 0) {
    return json_({ success: false, error: 'ORDER_NOT_FOUND', message: 'Order ' + orderId + ' was not found.' });
  }

  for (var r = 0; r < targetRows.length; r++) {
    ordersSheet.getRange(targetRows[r], CONFIG.COL.ORDER_STATUS).setValue(status);
  }
  SpreadsheetApp.flush();

  return json_({
    success: true,
    orderId: orderId,
    paymentStatus: status,
    updated: targetRows.length,
    message: 'Order ' + orderId + ' marked ' + status + ' (' + targetRows.length + ' row(s)).'
  });
}

/* ==========================================================================
 *  Reading
 * ======================================================================== */

function readItems_(ss) {
  var sheet = getSheet_(ss, CONFIG.ITEMS_SHEET, CONFIG.ITEMS_SHEET_ALIASES);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, itemColumnCount_(sheet)).getValues();
  var items = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var id = trim_(row[0]);
    if (!id) continue;

    items.push({
      id: id,
      category: trim_(row[1]),
      name: trim_(row[2]) || id,
      image: trim_(row[3]),
      stock: toInt_(row[4]),
      price: toPrice_(row[5])
    });
  }

  return items;
}

function readOrders_(ss) {
  var sheet = getSheet_(ss, CONFIG.ORDERS_SHEET, CONFIG.ORDERS_SHEET_ALIASES);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  var orders = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var orderId = trim_(row[0]);
    var itemId = trim_(row[1]);
    if (!orderId && !itemId) continue;

    var quantity = toInt_(row[2]);
    orders.push({
      orderId: orderId,
      itemId: itemId,
      quantity: quantity,
      paymentStatus: (trim_(row[3]) || 'pending').toLowerCase()
    });
  }

  return orders;
}

/** Builds { itemId: { row, stock, ... } } together with a header sanity check. */
function buildItemIndex_(sheet) {
  var lastRow = sheet.getLastRow();
  var index = {};
  if (lastRow < 2) return index;

  var values = sheet.getRange(2, 1, lastRow - 1, itemColumnCount_(sheet)).getValues();
  for (var i = 0; i < values.length; i++) {
    var id = trim_(values[i][0]);
    if (!id) continue;
    index[id] = {
      row: i + 2,
      id: id,
      category: trim_(values[i][1]),
      name: trim_(values[i][2]) || id,
      stock: toInt_(values[i][4])
    };
  }
  return index;
}

/* ==========================================================================
 *  Order id allocation
 * ======================================================================== */

/**
 * OR001, OR002, … based on the highest numeric suffix already present, then
 * de-duplicated against every existing id. Never derives an id from the row
 * count alone, so deleting a middle row cannot produce a duplicate.
 */
function nextOrderId_(sheet) {
  var lastRow = sheet.getLastRow();
  var used = {};
  var max = 0;

  if (lastRow >= 2) {
    var ids = sheet.getRange(2, CONFIG.COL.ORDER_ID, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      var id = trim_(ids[i][0]).toUpperCase();
      if (!id) continue;
      used[id] = true;
      var match = id.match(/^OR0*(\d+)$/);
      if (match) {
        var numeric = parseInt(match[1], 10);
        if (numeric > max) max = numeric;
      }
    }
  }

  var candidate = max + 1;
  var generated = CONFIG.ORDER_PREFIX + pad_(candidate, CONFIG.ORDER_ID_WIDTH);
  while (used[generated]) {
    candidate += 1;
    generated = CONFIG.ORDER_PREFIX + pad_(candidate, CONFIG.ORDER_ID_WIDTH);
  }
  return generated;
}

/* ==========================================================================
 *  Validation helpers
 * ======================================================================== */

function validateOrderLines_(rawItems) {
  if (!Array.isArray(rawItems)) {
    return { ok: false, message: 'The request must include an "items" array.' };
  }
  if (rawItems.length === 0) {
    return { ok: false, message: 'The cart is empty — add at least one item.' };
  }
  if (rawItems.length > CONFIG.MAX_LINES_PER_ORDER) {
    return { ok: false, message: 'An order cannot contain more than ' + CONFIG.MAX_LINES_PER_ORDER + ' lines.' };
  }

  var seen = {};
  var lines = [];

  for (var i = 0; i < rawItems.length; i++) {
    var entry = rawItems[i];
    if (!entry || typeof entry !== 'object') {
      return { ok: false, message: 'Line ' + (i + 1) + ' is not a valid object.' };
    }

    var itemId = entry.itemId === null || entry.itemId === undefined ? '' : String(entry.itemId).trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(itemId)) {
      return { ok: false, message: 'Line ' + (i + 1) + ' has an invalid item id.' };
    }

    var quantity = Number(entry.quantity);
    if (!isFinite(quantity) || Math.floor(quantity) !== quantity) {
      return { ok: false, message: 'Line ' + (i + 1) + ' (' + itemId + ') must have a whole-number quantity.' };
    }
    if (quantity < 1) {
      return { ok: false, message: 'Line ' + (i + 1) + ' (' + itemId + ') must be at least 1.' };
    }
    if (quantity > CONFIG.MAX_QUANTITY) {
      return { ok: false, message: 'Line ' + (i + 1) + ' (' + itemId + ') exceeds the maximum quantity of ' + CONFIG.MAX_QUANTITY + '.' };
    }
    if (seen[itemId]) {
      return { ok: false, message: 'Item ' + itemId + ' appears more than once — merge the lines first.' };
    }

    seen[itemId] = true;
    lines.push({ itemId: itemId, quantity: quantity });
  }

  return { ok: true, lines: lines };
}

/* ==========================================================================
 *  Low level helpers
 * ======================================================================== */

function openSpreadsheet_() {
  var id = CONFIG.SPREADSHEET_ID ? String(CONFIG.SPREADSHEET_ID).trim() : '';
  if (!id || id === 'PASTE_YOUR_SPREADSHEET_ID_HERE') {
    throw new Error(
      'CONFIG.SPREADSHEET_ID is not set. Open google-apps-script/Code.gs and replace ' +
      'PASTE_YOUR_SPREADSHEET_ID_HERE with the id from your Google Sheet URL: ' +
      'https://docs.google.com/spreadsheets/d/<THIS_PART>/edit'
    );
  }
  return SpreadsheetApp.openById(id);
}

/**
 * Resolves a tab by its configured name. When an `aliases` list is supplied the
 * first matching alternate spelling is used as a fallback, so a workbook that
 * names the tab "Items" instead of "items list" still works. The configured
 * name is always tried first.
 */
function getSheet_(ss, name, aliases) {
  var candidates = [name];
  if (Array.isArray(aliases)) {
    for (var a = 0; a < aliases.length; a++) {
      if (aliases[a] && aliases[a] !== name) candidates.push(aliases[a]);
    }
  }

  for (var c = 0; c < candidates.length; c++) {
    var found = ss.getSheetByName(candidates[c]);
    if (found) {
      if (c > 0) {
        console.log('[cafe-api] tab "' + name + '" not found; using alias "' + candidates[c] + '" instead.');
      }
      return found;
    }
  }

  // Diagnostics only: list the tabs that DO exist so a naming mismatch is
  // obvious in the API response instead of a bare "not found".
  var available = [];
  try {
    var all = typeof ss.getSheets === 'function' ? ss.getSheets() : [];
    for (var i = 0; i < all.length; i++) {
      available.push('"' + String(all[i].getName()) + '"');
    }
  } catch (ignored) {
    available = [];
  }

  throw new Error('Sheet tab "' + name + '" was not found. Tab names are case sensitive ' +
    'and must include spaces exactly as written.' +
    (available.length ? ' Tabs in this spreadsheet: ' + available.join(', ') + '.' : ''));
}

/**
 * Number of columns to read from the `items list` tab. The price column (F) is
 * optional, so a sheet that stops at `stock` (E) is read with 5 columns instead
 * of throwing "the coordinates or dimensions of the range are invalid".
 */
function itemColumnCount_(sheet) {
  var last = typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : CONFIG.COL.ITEM_PRICE;
  if (!last || last < CONFIG.COL.ITEM_STOCK) last = CONFIG.COL.ITEM_STOCK;
  return Math.max(CONFIG.COL.ITEM_STOCK, Math.min(last, CONFIG.COL.ITEM_PRICE));
}

function parseBody_(e) {
  if (e && e.postData && e.postData.contents) {
    try {
      var parsed = JSON.parse(e.postData.contents);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed)) return { action: '', items: parsed };
    } catch (parseError) {
      // fall through to the query-parameter branch
    }
  }

  if (e && e.parameter) {
    var params = {};
    for (var key in e.parameter) {
      if (Object.prototype.hasOwnProperty.call(e.parameter, key)) params[key] = e.parameter[key];
    }
    if (typeof params.items === 'string') {
      try { params.items = JSON.parse(params.items); } catch (inner) { /* leave as-is */ }
    }
    return params;
  }

  return null;
}

function failure_(error) {
  var message = String(error && error.message ? error.message : error);
  console.error('[cafe-api] ' + message + (error && error.stack ? '\n' + error.stack : ''));

  if (/SPREADSHEET_ID is not set/i.test(message)) {
    return { success: false, error: 'CONFIG_ERROR', message: message };
  }
  if (/was not found/i.test(message) && /Sheet tab/i.test(message)) {
    return { success: false, error: 'SHEET_NOT_FOUND', message: message };
  }
  return { success: false, error: 'UPSTREAM_ERROR', message: message };
}

function isLockError_(error) {
  if (!error) return false;
  var name = String(error.name || '');
  var message = String(error.message || '');
  return /LockTimeout|LockService/i.test(name) || /lock/i.test(message);
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function trim_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toInt_(value) {
  if (value === null || value === undefined || value === '') return 0;
  var number = Number(value);
  if (!isFinite(number)) return 0;
  var rounded = Math.round(number);
  return rounded > 0 ? rounded : 0;
}

function toPrice_(value) {
  if (value === null || value === undefined || value === '') return null;
  var number = Number(value);
  if (!isFinite(number) || number <= 0) return null;
  return number;
}

function pad_(number, width) {
  var text = String(number);
  while (text.length < width) text = '0' + text;
  return text;
}

/**
 * Optional helper: run it once from the Apps Script editor to print the
 * sheet id, handy while wiring the deployment.
 */
function debugShowConfig() {
  Logger.log('SPREADSHEET_ID = %s', CONFIG.SPREADSHEET_ID);
  Logger.log('items list rows = %s', openSpreadsheet_().getSheetByName(CONFIG.ITEMS_SHEET).getLastRow());
  Logger.log('order list rows = %s', openSpreadsheet_().getSheetByName(CONFIG.ORDERS_SHEET).getLastRow());
}
