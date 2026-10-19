/**
 * Minimal Google Apps Script runtime shim.
 *
 * Lets `google-apps-script/Code.gs` run unmodified inside Node so the
 * transaction logic (stock deduction, oversell protection, order id
 * allocation, rollback, payment status) can be tested automatically.
 *
 * Test-only code — never shipped to the browser or used at runtime.
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CODE_PATH = path.resolve(here, "..", "..", "google-apps-script", "Code.gs");

const MIN_COLUMNS = 6;

/** The spreadsheet used in every test — mirrors the user's real sheet. */
export const SEED = {
  items: [
    ["id", "category", "name", "image", "stock"],
    ["a1", "snacks", "pizza", "", 78],
    ["a2", "snacks", "french fries", "", 20],
    ["a3", "snacks", "nuggets", "", 40],
    ["a4", "snacks", "popcorn", "", 90],
    ["a5", "beverages", "coffee", "", 30],
    ["a6", "beverages", "tea", "", 50],
  ],
  orders: [
    ["order id", "item id", "quantity order", "payment status"],
    ["OR001", "a1", 2, "pending"],
    ["OR002", "a3", 1, "paid"],
    ["OR003", "a5", 4, "paid"],
    ["OR004", "a6", 6, "pending"],
    ["OR006", "a4", 2, "paid"],
  ],
};

function cloneRows(rows) {
  return rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : cell)));
}

export function createSheet(name, rows, columns = MIN_COLUMNS, hooks = {}) {
  const cells = rows.map((row) => {
    const next = new Array(Math.max(columns, row.length)).fill("");
    for (let index = 0; index < row.length; index += 1) {
      const value = row[index];
      next[index] = value === null || value === undefined ? "" : value;
    }
    return next;
  });

  const width = () => cells.reduce((max, row) => Math.max(max, row.length), MIN_COLUMNS);

  function ensure(rowIndex, columnIndex) {
    while (cells.length < rowIndex) cells.push(new Array(width()).fill(""));
    const row = cells[rowIndex - 1];
    while (row.length < columnIndex) row.push("");
  }

  return {
    getName: () => name,

    getLastRow() {
      let last = 0;
      for (let index = 0; index < cells.length; index += 1) {
        if (cells[index].some((value) => value !== "" && value !== null)) last = index + 1;
      }
      return last;
    },

    getLastColumn() {
      let last = 0;
      for (const row of cells) {
        for (let index = 0; index < row.length; index += 1) {
          if (row[index] !== "" && row[index] !== null) last = Math.max(last, index + 1);
        }
      }
      return last;
    },

    getRange(row, column, numRows = 1, numColumns = 1) {
      if (!Number.isInteger(row) || row < 1) throw new Error(`getRange: invalid row ${row}`);
      if (!Number.isInteger(column) || column < 1) {
        throw new Error(`getRange: invalid column ${column}`);
      }

      return {
        getValues() {
          const output = [];
          for (let r = 0; r < numRows; r += 1) {
            const source = cells[row - 1 + r] ?? [];
            const line = [];
            for (let c = 0; c < numColumns; c += 1) {
              const value = source[column - 1 + c];
              line.push(value === undefined || value === null ? "" : value);
            }
            output.push(line);
          }
          return output;
        },

        setValue(value) {
          if (hooks.onBeforeWrite) hooks.onBeforeWrite({ sheet: name, row, column, value });
          ensure(row, column);
          cells[row - 1][column - 1] = value;
        },

        setValues(matrix) {
          if (
            !Array.isArray(matrix) ||
            matrix.length !== numRows ||
            matrix.some((line) => !Array.isArray(line) || line.length !== numColumns)
          ) {
            throw new Error("setValues: dimensions do not match the range.");
          }
          if (hooks.onBeforeSetValues) hooks.onBeforeSetValues({ sheet: name, row, values: matrix });
          for (let r = 0; r < numRows; r += 1) {
            ensure(row + r, column + numColumns - 1);
            for (let c = 0; c < numColumns; c += 1) {
              cells[row - 1 + r][column - 1 + c] = matrix[r][c];
            }
          }
          if (hooks.onAfterSetValues) hooks.onAfterSetValues({ sheet: name, row, values: matrix });
        },
      };
    },

    /** Replaces the whole grid (used by the test backend's reset endpoint). */
    replace(rows) {
      cells.length = 0;
      for (const row of rows) {
        const next = new Array(Math.max(columns, row.length)).fill("");
        for (let index = 0; index < row.length; index += 1) {
          next[index] = row[index] === null || row[index] === undefined ? "" : row[index];
        }
        cells.push(next);
      }
    },

    toRows() {
      const lastRow = this.getLastRow();
      return cells.slice(0, lastRow).map((row) => row.slice());
    },
  };
}

export function createRuntime(seed = SEED, options = {}) {
  /** Ordered log of every lock + sheet interaction (used by assertions). */
  const log = [];
  let failNextOrderAppend = false;
  const omit = new Set(options.omitSheets ?? []);

  const hooks = {
    onBeforeWrite: (event) => {
      log.push({ type: "write", ...event });
    },
    onBeforeSetValues: (event) => {
      log.push({ type: "bulkWrite", sheet: event.sheet, row: event.row });
      if (failNextOrderAppend && event.sheet === "order list") {
        failNextOrderAppend = false;
        throw new Error("Simulated spreadsheet failure while appending the order.");
      }
    },
  };

  const sheets = {};
  if (!omit.has("items list")) {
    sheets["items list"] = createSheet("items list", cloneRows(seed.items), MIN_COLUMNS, hooks);
  }
  if (!omit.has("order list")) {
    sheets["order list"] = createSheet("order list", cloneRows(seed.orders), MIN_COLUMNS, hooks);
  }

  const SpreadsheetApp = {
    openById(id) {
      log.push({ type: "openById", id });
      if (id !== "test-sheet-id") {
        throw new Error(`Unexpected spreadsheet id "${id}"`);
      }
      return {
        getSheetByName(name) {
          return sheets[name] ?? null;
        },
        getSheets() {
          return Object.keys(sheets).map((name) => sheets[name]);
        },
      };
    },
    flush() {
      log.push({ type: "flush" });
    },
  };

  const LockService = {
    getScriptLock() {
      return {
        waitLock() {
          log.push({ type: "lock:waitLock" });
        },
        releaseLock() {
          log.push({ type: "lock:releaseLock" });
        },
      };
    },
  };

  const ContentService = {
    MimeType: { JSON: "application/json", TEXT: "text/plain" },
    createTextOutput(text) {
      const output = {
        mimeType: "text/plain",
        setMimeType(mimeType) {
          output.mimeType = mimeType;
          return output;
        },
        getContent() {
          return text;
        },
        getMimeType() {
          return output.mimeType;
        },
      };
      return output;
    },
  };

  const context = vm.createContext({
    SpreadsheetApp,
    LockService,
    ContentService,
    Logger: { log: (...args) => log.push({ type: "logger", args }) },
    console: {
      log: (...args) => log.push({ type: "console", args }),
      error: (...args) => log.push({ type: "console:error", args }),
      warn: (...args) => log.push({ type: "console:warn", args }),
    },
  });

  const source = fs.readFileSync(CODE_PATH, "utf8");
  vm.runInContext(source, context, { filename: CODE_PATH });

  /** Points CONFIG.SPREADSHEET_ID at the fake spreadsheet. */
  context.CONFIG.SPREADSHEET_ID = "test-sheet-id";

  function invoke(entry, event) {
    log.length = 0;
    const output = vm.runInContext(`${entry}(${JSON.stringify(event)})`, context);
    const content = output.getContent();
    return { payload: JSON.parse(content), raw: content, mimeType: output.getMimeType() };
  }

  return {
    log,
    sheets,
    doGet: (event) => invoke("doGet", event),
    doPost: (event) => invoke("doPost", event),
    getItemsRows: () => (sheets["items list"] ? sheets["items list"].toRows() : []),
    getOrderRows: () => (sheets["order list"] ? sheets["order list"].toRows() : []),
    reset(nextSeed) {
      if (sheets["items list"]) sheets["items list"].replace(cloneRows(nextSeed.items));
      if (sheets["order list"]) sheets["order list"].replace(cloneRows(nextSeed.orders));
      failNextOrderAppend = false;
      log.length = 0;
    },
    failNextOrderAppend() {
      failNextOrderAppend = true;
    },
    stockOf(itemId) {
      const rows = sheets["items list"] ? sheets["items list"].toRows() : [];
      const row = rows.find((entry, index) => index > 0 && String(entry[0]).trim() === itemId);
      return row ? Number(row[4]) : null;
    },
  };
}

/** Convenience wrappers that build Apps Script event objects. */
export function getEvent(action) {
  return { parameter: { action } };
}

export function postEvent(payload) {
  return { parameter: {}, postData: { contents: JSON.stringify(payload) } };
}
