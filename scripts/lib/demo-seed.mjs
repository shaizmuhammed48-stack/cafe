/**
 * Dummy spreadsheet used by `npm run dev:mock`.
 *
 * This is the ONLY place fake data lives. It is fed to scripts/fake-apps-script.mjs,
 * which runs the real google-apps-script/Code.gs over HTTP, so the app still goes
 * through its normal inventory/order pipeline — nothing is hardcoded in the UI.
 *
 * Columns mirror the real sheet:
 *   items list → A: id | B: category | C: name | D: image | E: stock | F: price
 *   order list → A: order id | B: item id | C: quantity order | D: payment status
 *
 * Edit freely to preview different products, stock levels or sold-out states.
 */

export const DEMO_SEED = {
  items: [
    ["id", "category", "name", "image", "stock", "price"],

    // Pizza
    ["a1", "Pizza", "Margherita Pizza", "/images/pizza.jpg", 24, 12.5],
    ["a2", "Pizza", "Wood-Fired Pepperoni", "/images/hero-pizza.jpg", 18, 14],
    ["a3", "Pizza", "Truffle Mushroom Pizza", "/images/pizza.jpg", 9, 15.5],

    // Snacks
    ["a4", "Snacks", "Hand-Cut French Fries", "/images/french-fries.jpg", 40, 4.5],
    ["a5", "Snacks", "Crispy Chicken Nuggets", "/images/nuggets.jpg", 32, 6],
    ["a6", "Snacks", "Butter Popcorn", "/images/popcorn.jpg", 60, 3.5],
    // Sold out on purpose, to show the "Unavailable" state.
    ["a7", "Snacks", "Loaded Nachos", "/images/nuggets.jpg", 0, 7],

    // Beverages
    ["a8", "Beverages", "Yirgacheffe Coffee", "/images/coffee.jpg", 30, 3.75],
    ["a9", "Beverages", "Cardamom Chai Tea", "/images/tea.jpg", 45, 3.25],
    // Low stock on purpose, to show the "low stock" badge.
    ["a10", "Beverages", "Iced Latte", "/images/coffee.jpg", 5, 4.25],

    // Desserts
    ["a11", "Desserts", "Molten Chocolate Cake", "/images/popcorn.jpg", 12, 5.5],
    ["a12", "Desserts", "Vanilla Gelato", "/images/tea.jpg", 20, 4],
  ],

  orders: [
    ["order id", "item id", "quantity order", "payment status"],
    ["OR001", "a1", 2, "pending"],
    ["OR002", "a5", 1, "paid"],
    ["OR003", "a8", 4, "paid"],
    ["OR004", "a9", 6, "pending"],
    ["OR006", "a6", 2, "paid"],
    ["OR007", "a4", 3, "pending"],
  ],
};
