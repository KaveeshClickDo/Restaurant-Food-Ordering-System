import { Category, MealPeriod, MenuItem } from "@/types";

// The Time Café, Nuneaton — menu transcribed from thetimecafe.co.uk (May 2026
// menu proof). Prices in GBP. No images yet: every item ships without an
// `image`, so the POS/menu falls back to the category emoji tile. Descriptions
// use the café's own dish notes where the site provided them, plus each
// section's "served with…" line folded in so ordering context isn't lost.

export const categories: Category[] = [
  // --- Parent Categories ---
  { id: "parent-breakfast", name: "Breakfast", emoji: "🍳" },
  { id: "parent-lunch", name: "Lunch & Mains", emoji: "🍽️" },
  { id: "parent-desserts-drinks", name: "Desserts & Drinks", emoji: "☕" },
  { id: "parent-bar", name: "Bar", emoji: "🍺" },

  // Breakfast
  { id: "all-day-breakfast", name: "All Day Breakfast", emoji: "🍳", parentId: "parent-breakfast" },
  { id: "omelettes", name: "Omelettes", emoji: "🍳", parentId: "parent-breakfast" },
  { id: "soup", name: "Homemade Soup", emoji: "🍲", parentId: "parent-breakfast" },
  { id: "extras", name: "Extras", emoji: "🥓", parentId: "parent-breakfast" },

  // Lunch & Mains
  { id: "panini", name: "Toasted Panini", emoji: "🥪", parentId: "parent-lunch" },
  { id: "jacket-potatoes", name: "Jacket Potatoes", emoji: "🥔", parentId: "parent-lunch" },
  { id: "burgers", name: "Burgers", emoji: "🍔", parentId: "parent-lunch" },
  { id: "sandwiches", name: "Sandwiches & Baguettes", emoji: "🥖", parentId: "parent-lunch" },
  { id: "wraps", name: "Wraps", emoji: "🌯", parentId: "parent-lunch" },
  { id: "roast-dinners", name: "Roast Dinners", emoji: "🍗", parentId: "parent-lunch" },
  { id: "pies", name: "Pies", emoji: "🥧", parentId: "parent-lunch" },
  { id: "special-dishes", name: "Time Special Dishes", emoji: "🍛", parentId: "parent-lunch" },
  { id: "salads", name: "Healthy Salads", emoji: "🥗", parentId: "parent-lunch" },
  { id: "kids-menu", name: "Kids Menu", emoji: "🧒", parentId: "parent-lunch" },

  // Desserts & Drinks
  { id: "desserts", name: "Desserts", emoji: "🍰", parentId: "parent-desserts-drinks" },
  { id: "hot-drinks", name: "Hot Drinks", emoji: "☕", parentId: "parent-desserts-drinks" },
  { id: "cold-drinks", name: "Cold Drinks", emoji: "🥤", parentId: "parent-desserts-drinks" },
  { id: "milkshakes", name: "Milkshakes", emoji: "🥤", parentId: "parent-desserts-drinks" },

  // Bar
  { id: "beers", name: "Beers", emoji: "🍺", parentId: "parent-bar" },
  { id: "shots", name: "Shots", emoji: "🥃", parentId: "parent-bar" },
  { id: "wines", name: "Wines", emoji: "🍷", parentId: "parent-bar" },
];

// Café trades Mon–Sat 9–5, Sun 10–4. "All Day" covers the everyday menu;
// "Sunday Roast" is a Sunday-only window that the roast dinners are tagged to,
// mirroring the menu's "Sundays Only" note. Admin can rename/retime these.
export const mealPeriods: MealPeriod[] = [
  {
    id: "mp-all-day", name: "All Day",
    enabled: true, startTime: "09:00", endTime: "17:00",
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    sortOrder: 0,
    themeColor: "#f59e0b", // Amber-500
  },
  {
    id: "mp-sunday-roast", name: "Sunday Roast",
    enabled: true, startTime: "12:00", endTime: "16:00",
    daysOfWeek: [0], // Sundays only
    sortOrder: 1,
    themeColor: "#b91c1c", // Red-700
  },
];

export const menuItems: MenuItem[] = [
  /* ── ALL DAY BREAKFAST ────────────────────────────── */
  {
    id: "bf1", categoryId: "all-day-breakfast",
    name: "Breakfast 1",
    description: "Egg, 2 bacon, sausage, beans and toast.",
    price: 7.09, dietary: [], popular: true,
  },
  {
    id: "bf2", categoryId: "all-day-breakfast",
    name: "Breakfast 2",
    description: "Egg, 2 bacon, 2 hash browns, mushrooms, beans, grilled tomatoes and toast.",
    price: 8.59, dietary: [], popular: true,
  },
  {
    id: "bf3", categoryId: "all-day-breakfast",
    name: "Time Special",
    description: "2 eggs, 2 bacon, 2 sausages, 2 hash browns, mushrooms, beans and toast.",
    price: 9.99, dietary: [], popular: true,
  },
  {
    id: "bf4", categoryId: "all-day-breakfast",
    name: "Veggie Breakfast",
    description: "Egg, veggie sausage, mushrooms, tomatoes, 2 hash browns, beans and toast.",
    price: 9.09, dietary: ["vegetarian"], popular: true,
  },
  {
    id: "bf5", categoryId: "all-day-breakfast",
    name: "Ham, Egg and Chips",
    description: "2 slices of ham with egg and chips.",
    price: 7.29, dietary: [],
  },
  {
    id: "bf6", categoryId: "all-day-breakfast",
    name: "Bacon, Egg and Chips",
    description: "2 rashers of bacon with egg and chips.",
    price: 7.29, dietary: [],
  },
  {
    id: "bf7", categoryId: "all-day-breakfast",
    name: "Sausage, Egg and Chips",
    description: "2 sausages with egg and chips.",
    price: 7.29, dietary: [],
  },
  {
    id: "bf8", categoryId: "all-day-breakfast",
    name: "Sausage, Chips and Beans",
    description: "2 sausages with chips and beans.",
    price: 7.29, dietary: [],
  },
  {
    id: "bf9", categoryId: "all-day-breakfast",
    name: "Poached Eggs on Toast",
    description: "2 poached eggs on 2 toast.",
    price: 6.29, dietary: ["vegetarian"],
  },
  {
    id: "bf10", categoryId: "all-day-breakfast",
    name: "Fried Eggs on Toast",
    description: "2 fried eggs on 2 toast.",
    price: 5.29, dietary: ["vegetarian"],
  },
  {
    id: "bf11", categoryId: "all-day-breakfast",
    name: "Scrambled Eggs on Toast",
    description: "2 scrambled eggs on 2 toast.",
    price: 5.29, dietary: ["vegetarian"],
  },
  {
    id: "bf12", categoryId: "all-day-breakfast",
    name: "Cheese on Toast",
    description: "",
    price: 5.29, dietary: ["vegetarian"],
  },
  {
    id: "bf13", categoryId: "all-day-breakfast",
    name: "Beans on Toast",
    description: "",
    price: 5.05, dietary: ["vegetarian"],
  },
  {
    id: "bf14", categoryId: "all-day-breakfast",
    name: "Jam or Marmalade on Toast",
    description: "",
    price: 3.05, dietary: ["vegetarian"],
  },

  /* ── OMELETTES (served with chips & salad) ────────────────────────────── */
  {
    id: "om1", categoryId: "omelettes",
    name: "Plain Omelette",
    description: "Served with chips and salad.",
    price: 6.30, dietary: ["vegetarian"],
  },
  {
    id: "om2", categoryId: "omelettes",
    name: "Mushroom Omelette",
    description: "Served with chips and salad.",
    price: 7.75, dietary: ["vegetarian"],
  },
  {
    id: "om3", categoryId: "omelettes",
    name: "Cheese Omelette",
    description: "Served with chips and salad.",
    price: 7.95, dietary: ["vegetarian"],
  },
  {
    id: "om4", categoryId: "omelettes",
    name: "Sausage Omelette",
    description: "Served with chips and salad.",
    price: 8.00, dietary: [],
  },
  {
    id: "om5", categoryId: "omelettes",
    name: "Ham Omelette",
    description: "Served with chips and salad.",
    price: 8.10, dietary: [],
  },
  {
    id: "om6", categoryId: "omelettes",
    name: "Bacon Omelette",
    description: "Served with chips and salad.",
    price: 7.75, dietary: [],
  },
  {
    id: "om7", categoryId: "omelettes",
    name: "Spanish Omelette",
    description: "Cheese, onion, mushroom, tomatoes and peas. Served with chips and salad.",
    price: 9.45, dietary: ["vegetarian"],
  },
  {
    id: "om8", categoryId: "omelettes",
    name: "Extra Fillings",
    description: "Add an extra omelette filling.",
    price: 1.99, dietary: [],
  },

  /* ── HOMEMADE SOUP ────────────────────────────── */
  {
    id: "sp1", categoryId: "soup",
    name: "Time Homemade Soup with Toast",
    description: "Chicken or tomato, served with toast.",
    price: 3.99, dietary: [], popular: true,
  },

  /* ── EXTRAS ────────────────────────────── */
  {
    id: "ex1", categoryId: "extras",
    name: "1 Egg", description: "", price: 1.40, dietary: ["vegetarian"],
  },
  {
    id: "ex2", categoryId: "extras",
    name: "Black Pudding (2)", description: "", price: 1.99, dietary: [],
  },
  {
    id: "ex3", categoryId: "extras",
    name: "Extra Toast", description: "", price: 1.25, dietary: ["vegetarian"],
  },
  {
    id: "ex4", categoryId: "extras",
    name: "5 Onion Rings", description: "", price: 3.00, dietary: ["vegetarian"],
  },
  {
    id: "ex5", categoryId: "extras",
    name: "1 Slice of Bacon", description: "", price: 1.75, dietary: [],
  },
  {
    id: "ex6", categoryId: "extras",
    name: "Beans", description: "", price: 1.50, dietary: ["vegetarian"],
  },
  {
    id: "ex7", categoryId: "extras",
    name: "Mushrooms", description: "", price: 1.50, dietary: ["vegetarian"],
  },
  {
    id: "ex8", categoryId: "extras",
    name: "1 Sausage", description: "", price: 1.75, dietary: [],
  },
  {
    id: "ex9", categoryId: "extras",
    name: "Tinned Tomatoes", description: "", price: 1.70, dietary: ["vegetarian"],
  },
  {
    id: "ex10", categoryId: "extras",
    name: "2 Slices of Ham", description: "", price: 2.99, dietary: [],
  },
  {
    id: "ex11", categoryId: "extras",
    name: "2 Hash Browns", description: "", price: 2.29, dietary: ["vegetarian"],
  },
  {
    id: "ex12", categoryId: "extras",
    name: "Small Chips", description: "", price: 3.85, dietary: ["vegetarian"],
  },
  {
    id: "ex13", categoryId: "extras",
    name: "Large Chips to Share", description: "", price: 4.55, dietary: ["vegetarian"],
  },
  {
    id: "ex14", categoryId: "extras",
    name: "Cheesy Small Chips", description: "", price: 5.15, dietary: ["vegetarian"],
  },
  {
    id: "ex15", categoryId: "extras",
    name: "Cheesy Large Chips", description: "", price: 6.14, dietary: ["vegetarian"],
  },
  {
    id: "ex16", categoryId: "extras",
    name: "Chip Batch", description: "", price: 4.05, dietary: ["vegetarian"],
  },

  /* ── TOASTED PANINI (served with a side salad & dressing) ─────────── */
  {
    id: "pn1", categoryId: "panini",
    name: "Cheese and Tomato",
    description: "Served with a side salad and dressing.",
    price: 6.90, dietary: ["vegetarian"],
  },
  {
    id: "pn2", categoryId: "panini",
    name: "Cheese and Onion",
    description: "Served with a side salad and dressing.",
    price: 6.90, dietary: ["vegetarian"],
  },
  {
    id: "pn3", categoryId: "panini",
    name: "Bacon, Sausage and Egg",
    description: "Served with a side salad and dressing.",
    price: 8.35, dietary: [],
  },
  {
    id: "pn4", categoryId: "panini",
    name: "Bacon and Cheese",
    description: "Served with a side salad and dressing.",
    price: 7.10, dietary: [],
  },
  {
    id: "pn5", categoryId: "panini",
    name: "Ham and Cheese",
    description: "Served with a side salad and dressing.",
    price: 7.10, dietary: [],
  },
  {
    id: "pn6", categoryId: "panini",
    name: "Tuna and Cheese",
    description: "Served with a side salad and dressing.",
    price: 8.10, dietary: [],
  },
  {
    id: "pn7", categoryId: "panini",
    name: "Time Grilled Chicken, Pesto & Cheese",
    description: "Marinated in spices and grilled to perfection. Served with a side salad and dressing.",
    price: 7.85, dietary: [],
  },
  {
    id: "pn8", categoryId: "panini",
    name: "Sausage, Fried Onion & Cheese",
    description: "Served with a side salad and dressing.",
    price: 7.85, dietary: [],
  },
  {
    id: "pn9", categoryId: "panini",
    name: "Time Grilled Chicken, Bacon & Cheese",
    description: "Served with a side salad and dressing.",
    price: 8.10, dietary: [],
  },
  {
    id: "pn10", categoryId: "panini",
    name: "Time Grilled Chicken, Bacon and Avocado",
    description: "Served with a side salad and dressing.",
    price: 8.60, dietary: [],
  },

  /* ── JACKET POTATOES (served with salad & dressing) ─────────────── */
  {
    id: "jp1", categoryId: "jacket-potatoes",
    name: "Plain Jacket Potato",
    description: "Served with salad and dressing.",
    price: 6.04, dietary: ["vegetarian"],
  },
  {
    id: "jp2", categoryId: "jacket-potatoes",
    name: "Cheese",
    description: "Served with salad and dressing.",
    price: 7.35, dietary: ["vegetarian"],
  },
  {
    id: "jp3", categoryId: "jacket-potatoes",
    name: "Beans",
    description: "Served with salad and dressing.",
    price: 7.10, dietary: ["vegetarian"],
  },
  {
    id: "jp4", categoryId: "jacket-potatoes",
    name: "Coleslaw",
    description: "Served with salad and dressing.",
    price: 6.55, dietary: ["vegetarian"],
  },
  {
    id: "jp5", categoryId: "jacket-potatoes",
    name: "Cheese and Beans",
    description: "Served with salad and dressing.",
    price: 7.85, dietary: ["vegetarian"],
  },
  {
    id: "jp6", categoryId: "jacket-potatoes",
    name: "Meat Balls",
    description: "Served with salad and dressing.",
    price: 8.10, dietary: [],
  },
  {
    id: "jp7", categoryId: "jacket-potatoes",
    name: "Mild Chicken Curry",
    description: "Served with salad and dressing.",
    price: 7.85, dietary: [],
  },
  {
    id: "jp8", categoryId: "jacket-potatoes",
    name: "Chilli Con Carne",
    description: "Served with salad and dressing.",
    price: 7.85, dietary: [],
  },
  {
    id: "jp9", categoryId: "jacket-potatoes",
    name: "Prawn in Seafood Sauce",
    description: "Served with salad and dressing.",
    price: 8.10, dietary: [],
  },
  {
    id: "jp10", categoryId: "jacket-potatoes",
    name: "Tuna Mayo",
    description: "Served with salad and dressing.",
    price: 7.85, dietary: [],
  },
  {
    id: "jp11", categoryId: "jacket-potatoes",
    name: "Extra Fillings",
    description: "Cheese, coleslaw and beans.",
    price: 2.30, dietary: ["vegetarian"],
  },

  /* ── BURGERS (served with lettuce, fried onion & tomato) ──────────── */
  // Base price = "On its own"; the "With chips" option adds £1.00. Optional
  // add-ons (bacon, cheese, egg, etc.) are attached to every burger.
  {
    id: "bg1", categoryId: "burgers",
    name: "Time Grilled Chicken Burger",
    description: "Freshly grilled to order and served with lettuce, fried onion and tomato.",
    price: 7.35, dietary: [], popular: true,
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "own", label: "On its own", price: 0 },
          { id: "chips", label: "With chips", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-bacon", name: "Add Bacon", price: 1.75 },
      { id: "add-halloumi", name: "Add Halloumi Cheese", price: 2.45 },
      { id: "add-cheese", name: "Add Cheese", price: 1.55 },
      { id: "add-egg", name: "Add Egg", price: 1.39 },
      { id: "add-onion-rings", name: "Add Onion Rings", price: 3.00 },
    ],
  },
  {
    id: "bg2", categoryId: "burgers",
    name: "Chicken Fillet Burger",
    description: "Served with lettuce, fried onion and tomato.",
    price: 7.35, dietary: [],
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "own", label: "On its own", price: 0 },
          { id: "chips", label: "With chips", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-bacon", name: "Add Bacon", price: 1.75 },
      { id: "add-halloumi", name: "Add Halloumi Cheese", price: 2.45 },
      { id: "add-cheese", name: "Add Cheese", price: 1.55 },
      { id: "add-egg", name: "Add Egg", price: 1.39 },
      { id: "add-onion-rings", name: "Add Onion Rings", price: 3.00 },
    ],
  },
  {
    id: "bg3", categoryId: "burgers",
    name: "8oz Cheese Burger with Bacon",
    description: "Served with lettuce, fried onion and tomato.",
    price: 9.60, dietary: [],
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "own", label: "On its own", price: 0 },
          { id: "chips", label: "With chips", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-bacon", name: "Add Bacon", price: 1.75 },
      { id: "add-halloumi", name: "Add Halloumi Cheese", price: 2.45 },
      { id: "add-cheese", name: "Add Cheese", price: 1.55 },
      { id: "add-egg", name: "Add Egg", price: 1.39 },
      { id: "add-onion-rings", name: "Add Onion Rings", price: 3.00 },
    ],
  },
  {
    id: "bg4", categoryId: "burgers",
    name: "16oz Beef Burger",
    description: "Served with lettuce, fried onion and tomato.",
    price: 9.60, dietary: [],
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "own", label: "On its own", price: 0 },
          { id: "chips", label: "With chips", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-bacon", name: "Add Bacon", price: 1.75 },
      { id: "add-halloumi", name: "Add Halloumi Cheese", price: 2.45 },
      { id: "add-cheese", name: "Add Cheese", price: 1.55 },
      { id: "add-egg", name: "Add Egg", price: 1.39 },
      { id: "add-onion-rings", name: "Add Onion Rings", price: 3.00 },
    ],
  },
  {
    id: "bg5", categoryId: "burgers",
    name: "8oz Beef Burger",
    description: "Served with lettuce, fried onion and tomato.",
    price: 7.35, dietary: [],
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "own", label: "On its own", price: 0 },
          { id: "chips", label: "With chips", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-bacon", name: "Add Bacon", price: 1.75 },
      { id: "add-halloumi", name: "Add Halloumi Cheese", price: 2.45 },
      { id: "add-cheese", name: "Add Cheese", price: 1.55 },
      { id: "add-egg", name: "Add Egg", price: 1.39 },
      { id: "add-onion-rings", name: "Add Onion Rings", price: 3.00 },
    ],
  },
  {
    id: "bg6", categoryId: "burgers",
    name: "Veggie Burger",
    description: "Served with lettuce, fried onion and tomato.",
    price: 7.35, dietary: ["vegetarian"],
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "own", label: "On its own", price: 0 },
          { id: "chips", label: "With chips", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-halloumi", name: "Add Halloumi Cheese", price: 2.45 },
      { id: "add-cheese", name: "Add Cheese", price: 1.55 },
      { id: "add-egg", name: "Add Egg", price: 1.39 },
      { id: "add-onion-rings", name: "Add Onion Rings", price: 3.00 },
    ],
  },

  /* ── SANDWICHES / BAGUETTES ────────────────────────────── */
  // Base price = sandwich; the "Baguette" option adds the site's price gap.
  // Baguettes come with a side salad and are white bread only.
  {
    id: "sw1", categoryId: "sandwiches",
    name: "Fried Egg",
    description: "",
    price: 4.40, dietary: ["vegetarian"],
    variations: [
      {
        id: "v-style", name: "Style", options: [
          { id: "sandwich", label: "Sandwich", price: 0 },
          { id: "baguette", label: "Baguette", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },
  {
    id: "sw2", categoryId: "sandwiches",
    name: "Cheese",
    description: "",
    price: 4.40, dietary: ["vegetarian"],
    variations: [
      {
        id: "v-style", name: "Style", options: [
          { id: "sandwich", label: "Sandwich", price: 0 },
          { id: "baguette", label: "Baguette", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },
  {
    id: "sw3", categoryId: "sandwiches",
    name: "Cheese and Tomato or Cheese and Onion",
    description: "",
    price: 4.66, dietary: ["vegetarian"],
    variations: [
      {
        id: "v-style", name: "Style", options: [
          { id: "sandwich", label: "Sandwich", price: 0 },
          { id: "baguette", label: "Baguette", price: 0.99 },
        ]
      },
    ],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },
  {
    id: "sw4", categoryId: "sandwiches",
    name: "Mushroom, Onion and Cheese",
    description: "",
    price: 4.90, dietary: ["vegetarian"],
    variations: [
      {
        id: "v-style", name: "Style", options: [
          { id: "sandwich", label: "Sandwich", price: 0 },
          { id: "baguette", label: "Baguette", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },
  {
    id: "sw5", categoryId: "sandwiches",
    name: "Bacon",
    description: "",
    price: 4.90, dietary: [],
    variations: [
      {
        id: "v-style", name: "Style", options: [
          { id: "sandwich", label: "Sandwich", price: 0 },
          { id: "baguette", label: "Baguette", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },
  {
    id: "sw6", categoryId: "sandwiches",
    name: "Ham Salad",
    description: "",
    price: 4.90, dietary: [],
    variations: [
      {
        id: "v-style", name: "Style", options: [
          { id: "sandwich", label: "Sandwich", price: 0 },
          { id: "baguette", label: "Baguette", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },
  {
    id: "sw7", categoryId: "sandwiches",
    name: "Cheese Salad",
    description: "",
    price: 4.90, dietary: ["vegetarian"],
    variations: [
      {
        id: "v-style", name: "Style", options: [
          { id: "sandwich", label: "Sandwich", price: 0 },
          { id: "baguette", label: "Baguette", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },
  {
    id: "sw8", categoryId: "sandwiches",
    name: "Ham and Cheese",
    description: "",
    price: 5.21, dietary: [],
    variations: [
      {
        id: "v-style", name: "Style", options: [
          { id: "sandwich", label: "Sandwich", price: 0 },
          { id: "baguette", label: "Baguette", price: 0.99 },
        ]
      },
    ],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },
  {
    id: "sw9", categoryId: "sandwiches",
    name: "Prawn in Seafood Sauce",
    description: "",
    price: 5.40, dietary: [],
    variations: [
      {
        id: "v-style", name: "Style", options: [
          { id: "sandwich", label: "Sandwich", price: 0 },
          { id: "baguette", label: "Baguette", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },
  {
    id: "sw10", categoryId: "sandwiches",
    name: "Bacon, Lettuce and Tomato",
    description: "",
    price: 4.90, dietary: [],
    variations: [
      {
        id: "v-style", name: "Style", options: [
          { id: "sandwich", label: "Sandwich", price: 0 },
          { id: "baguette", label: "Baguette", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },
  {
    id: "sw11", categoryId: "sandwiches",
    name: "Tuna, Mayo and Sweetcorn",
    description: "",
    price: 5.40, dietary: [],
    variations: [
      {
        id: "v-style", name: "Style", options: [
          { id: "sandwich", label: "Sandwich", price: 0 },
          { id: "baguette", label: "Baguette", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },
  {
    id: "sw12", categoryId: "sandwiches",
    name: "Sausage",
    description: "",
    price: 4.90, dietary: [],
    variations: [
      {
        id: "v-style", name: "Style", options: [
          { id: "sandwich", label: "Sandwich", price: 0 },
          { id: "baguette", label: "Baguette", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },
  {
    id: "sw13", categoryId: "sandwiches",
    name: "Bacon, Sausage and Egg",
    description: "",
    price: 6.15, dietary: [],
    variations: [
      {
        id: "v-style", name: "Style", options: [
          { id: "sandwich", label: "Sandwich", price: 0 },
          { id: "baguette", label: "Baguette", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },
  {
    id: "sw14", categoryId: "sandwiches",
    name: "Time Grilled Chicken and Cheese",
    description: "",
    price: 5.40, dietary: [],
    variations: [
      {
        id: "v-style", name: "Style", options: [
          { id: "sandwich", label: "Sandwich", price: 0 },
          { id: "baguette", label: "Baguette", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },
  {
    id: "sw15", categoryId: "sandwiches",
    name: "Time Grilled Chicken Salad",
    description: "",
    price: 5.40, dietary: [],
    variations: [
      {
        id: "v-style", name: "Style", options: [
          { id: "sandwich", label: "Sandwich", price: 0 },
          { id: "baguette", label: "Baguette", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },
  {
    id: "sw16", categoryId: "sandwiches",
    name: "Time Grilled Chicken and Bacon",
    description: "",
    price: 5.90, dietary: [],
    variations: [
      {
        id: "v-style", name: "Style", options: [
          { id: "sandwich", label: "Sandwich", price: 0 },
          { id: "baguette", label: "Baguette", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },
  {
    id: "sw17", categoryId: "sandwiches",
    name: "Time Grilled Chicken, Bacon and Avocado",
    description: "",
    price: 6.45, dietary: [],
    variations: [
      {
        id: "v-style", name: "Style", options: [
          { id: "sandwich", label: "Sandwich", price: 0 },
          { id: "baguette", label: "Baguette", price: 1.00 },
        ]
      },
    ],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },
  {
    id: "sw18", categoryId: "sandwiches",
    name: "Time Meatballs",
    description: "",
    price: 7.45, dietary: [],
    addOns: [
      { id: "add-toasted", name: "Make it toasted", price: 0.60 },
      { id: "add-fillings", name: "Extra fillings (mushroom, salad & cheese)", price: 1.25 },
    ],
  },

  /* ── WRAPS (served with chips) ────────────────────────────── */
  {
    id: "wr1", categoryId: "wraps",
    name: "Time Grilled Chicken Wrap",
    description: "Marinated in spices and grilled to perfection. Served with chips.",
    price: 8.85, dietary: [], popular: true,
  },
  {
    id: "wr2", categoryId: "wraps",
    name: "Halloumi, Mushroom, Pepper and Sweet Chilli Sauce",
    description: "Served with chips.",
    price: 8.85, dietary: ["vegetarian"],
  },
  {
    id: "wr3", categoryId: "wraps",
    name: "Bacon, Lettuce and Tomato",
    description: "Served with chips.",
    price: 7.10, dietary: [],
  },
  {
    id: "wr4", categoryId: "wraps",
    name: "Crispy Chicken Strips Wrap",
    description: "With mayo or sweet chilli sauce. Served with chips.",
    price: 8.85, dietary: [],
  },

  /* ── ROAST DINNERS (Sundays only) ────────────────────────────── */
  {
    id: "rd1", categoryId: "roast-dinners",
    name: "Roast Chicken",
    description: "Served with roast potatoes, Yorkshire pudding and mixed veg.",
    price: 10.10, dietary: [],
    mealPeriodIds: ["mp-sunday-roast"],
  },
  {
    id: "rd2", categoryId: "roast-dinners",
    name: "Roast Beef",
    description: "Served with roast potatoes, Yorkshire pudding and mixed veg.",
    price: 10.35, dietary: [],
    mealPeriodIds: ["mp-sunday-roast"],
  },

  /* ── PIES (with fries, peas & gravy) ────────────────────────────── */
  {
    id: "pie1", categoryId: "pies",
    name: "Steak and Kidney or Chicken and Mushroom Pie",
    description: "Served with fries, peas and gravy.",
    price: 8.15, dietary: [],
  },

  /* ── TIME SPECIAL DISHES ────────────────────────────── */
  {
    id: "sd1", categoryId: "special-dishes",
    name: "8 Chicken Nuggets and Chips",
    description: "",
    price: 9.10, dietary: [],
  },
  {
    id: "sd2", categoryId: "special-dishes",
    name: "Time Grilled Chicken, Chips and Salad",
    description: "Marinated in spices and grilled to perfection.",
    price: 9.85, dietary: [],
  },
  {
    id: "sd3", categoryId: "special-dishes",
    name: "Chilli Con Carne, Rice and Chips",
    description: "",
    price: 9.35, dietary: [],
  },
  {
    id: "sd4", categoryId: "special-dishes",
    name: "Time Meatballs, Rice & Chips",
    description: "",
    price: 9.95, dietary: [],
  },
  {
    id: "sd5", categoryId: "special-dishes",
    name: "Chicken Curry, Rice and Chips",
    description: "",
    price: 9.35, dietary: [],
  },
  {
    id: "sd6", categoryId: "special-dishes",
    name: "Time Grilled Chicken, Chips, Rice and Salad",
    description: "Marinated in spices and grilled to perfection.",
    price: 10.35, dietary: [],
  },
  {
    id: "sd7", categoryId: "special-dishes",
    name: "Scampi, Chips and Peas",
    description: "",
    price: 9.55, dietary: [],
  },

  /* ── HEALTHY SALADS ────────────────────────────── */
  {
    id: "sl1", categoryId: "salads",
    name: "Ham Salad", description: "", price: 7.60, dietary: [],
  },
  {
    id: "sl2", categoryId: "salads",
    name: "Cheese Salad", description: "", price: 7.60, dietary: ["vegetarian"],
  },
  {
    id: "sl3", categoryId: "salads",
    name: "Time Grilled Chicken Salad", description: "", price: 9.34, dietary: [],
  },
  {
    id: "sl4", categoryId: "salads",
    name: "Tuna Mayo and Sweetcorn Salad", description: "", price: 8.34, dietary: [],
  },
  {
    id: "sl5", categoryId: "salads",
    name: "Halloumi Salad", description: "", price: 8.10, dietary: ["vegetarian"],
  },
  {
    id: "sl6", categoryId: "salads",
    name: "Prawn in Seafood Sauce Salad", description: "", price: 8.35, dietary: [],
  },
  {
    id: "sl7", categoryId: "salads",
    name: "Tuna Salad", description: "", price: 8.10, dietary: [],
  },

  /* ── KIDS MENU (served with a Fruit Shoot) ────────────────────────── */
  {
    id: "km1", categoryId: "kids-menu",
    name: "4 Nuggets, Chips and Beans",
    description: "Served with a Fruit Shoot.",
    price: 5.85, dietary: [],
  },
  {
    id: "km2", categoryId: "kids-menu",
    name: "4 Fish Fingers, Chips and Beans",
    description: "Served with a Fruit Shoot.",
    price: 5.85, dietary: [],
  },
  {
    id: "km3", categoryId: "kids-menu",
    name: "Egg, Chips and Beans",
    description: "Served with a Fruit Shoot.",
    price: 5.85, dietary: ["vegetarian"],
  },
  {
    id: "km4", categoryId: "kids-menu",
    name: "Sausage, Chips & Beans",
    description: "Served with a Fruit Shoot.",
    price: 5.85, dietary: [],
  },

  /* ── DESSERTS ────────────────────────────── */
  {
    id: "ds1", categoryId: "desserts",
    name: "Ice Cream",
    description: "3 scoops.",
    price: 3.95, dietary: ["vegetarian"],
  },
  {
    id: "ds2", categoryId: "desserts",
    name: "Shortbread", description: "", price: 2.40, dietary: ["vegetarian"],
  },
  {
    id: "ds3", categoryId: "desserts",
    name: "Muffin", description: "", price: 3.50, dietary: ["vegetarian"],
  },
  {
    id: "ds4", categoryId: "desserts",
    name: "Fruity Pearls", description: "", price: 2.00, dietary: [],
  },
  {
    id: "ds5", categoryId: "desserts",
    name: "Cookie", description: "", price: 1.90, dietary: ["vegetarian"],
  },
  {
    id: "ds6", categoryId: "desserts",
    name: "All Cakes",
    description: "Carrot cake, red velvet, chocolate, lemon drizzle, Victoria sponge, toffee. Subject to availability.",
    price: 3.95, dietary: ["vegetarian"], popular: true,
  },
  {
    id: "ds7", categoryId: "desserts",
    name: "Waffle", description: "", price: 3.90, dietary: ["vegetarian"],
  },
  {
    id: "ds8", categoryId: "desserts",
    name: "Churros", description: "", price: 3.90, dietary: ["vegetarian"],
  },
  {
    id: "ds9", categoryId: "desserts",
    name: "Clotted Cream",
    description: "40gm.",
    price: 1.00, dietary: ["vegetarian"],
  },
  {
    id: "ds10", categoryId: "desserts",
    name: "Scone with Butter and Jam", description: "", price: 3.85, dietary: ["vegetarian"],
  },
  {
    id: "ds11", categoryId: "desserts",
    name: "Teacake with Jam or Marmalade", description: "", price: 3.85, dietary: ["vegetarian"],
  },

  /* ── HOT DRINKS ────────────────────────────── */
  {
    id: "hd1", categoryId: "hot-drinks",
    name: "Espresso", description: "", price: 2.20, dietary: ["vegetarian"],
  },
  {
    id: "hd2", categoryId: "hot-drinks",
    name: "Black Americano", description: "", price: 2.70, dietary: ["vegetarian"],
  },
  {
    id: "hd3", categoryId: "hot-drinks",
    name: "Americano with Milk on the Side", description: "", price: 2.95, dietary: ["vegetarian"],
  },
  {
    id: "hd4", categoryId: "hot-drinks",
    name: "Americano with Cream", description: "", price: 3.23, dietary: ["vegetarian"],
  },
  {
    id: "hd5", categoryId: "hot-drinks",
    name: "Mocha", description: "", price: 3.20, dietary: ["vegetarian"],
  },
  {
    id: "hd6", categoryId: "hot-drinks",
    name: "Latte", description: "", price: 2.95, dietary: ["vegetarian"],
  },
  {
    id: "hd7", categoryId: "hot-drinks",
    name: "Cappuccino", description: "", price: 2.95, dietary: ["vegetarian"],
  },
  {
    id: "hd8", categoryId: "hot-drinks",
    name: "Flat White", description: "", price: 3.20, dietary: ["vegetarian"],
  },
  {
    id: "hd9", categoryId: "hot-drinks",
    name: "White Coffee", description: "", price: 2.95, dietary: ["vegetarian"],
  },
  {
    id: "hd10", categoryId: "hot-drinks",
    name: "Herbal Tea", description: "", price: 2.45, dietary: ["vegetarian"],
  },
  {
    id: "hd11", categoryId: "hot-drinks",
    name: "Earl Grey Tea", description: "", price: 2.45, dietary: ["vegetarian"],
  },
  {
    id: "hd12", categoryId: "hot-drinks",
    name: "Tea / Decaf Tea", description: "", price: 1.95, dietary: ["vegetarian"],
  },
  {
    id: "hd13", categoryId: "hot-drinks",
    name: "Fresh Mint, Lemon and Honey Tea", description: "", price: 2.95, dietary: ["vegetarian"],
  },
  {
    id: "hd14", categoryId: "hot-drinks",
    name: "Hot Chocolate", description: "", price: 2.95, dietary: ["vegetarian"],
  },
  {
    id: "hd15", categoryId: "hot-drinks",
    name: "Hot Chocolate with Cream and Marshmallow", description: "", price: 3.45, dietary: ["vegetarian"],
  },
  {
    id: "hd16", categoryId: "hot-drinks",
    name: "Irish Coffee",
    description: "Brandy, Jack Daniels or Baileys.",
    price: 5.20, dietary: [],
  },
  {
    id: "hd17", categoryId: "hot-drinks",
    name: "Flavouring",
    description: "Caramel, hazelnut, vanilla, popcorn or gingerbread.",
    price: 1.25, dietary: ["vegetarian"],
  },

  /* ── COLD DRINKS ────────────────────────────── */
  {
    id: "cd1", categoryId: "cold-drinks",
    name: "Orange, Apple, Cranberry or Pineapple Juice", description: "", price: 2.70, dietary: ["vegan"],
  },
  {
    id: "cd2", categoryId: "cold-drinks",
    name: "Bottled Coke or Diet Coke", description: "", price: 2.45, dietary: ["vegan"],
  },
  {
    id: "cd3", categoryId: "cold-drinks",
    name: "Bottled Water or Sparkling Water", description: "", price: 1.70, dietary: ["vegan"],
  },
  {
    id: "cd4", categoryId: "cold-drinks",
    name: "Draft Pepsi Max, Diet Pepsi, Vimto, Mango or Lemonade", description: "", price: 2.45, dietary: ["vegan"],
  },
  {
    id: "cd5", categoryId: "cold-drinks",
    name: "Fruit Shoot",
    description: "Orange or blackcurrant.",
    price: 1.95, dietary: ["vegan"],
  },
  {
    id: "cd6", categoryId: "cold-drinks",
    name: "J2O",
    description: "Orange and passionfruit, apple raspberry, apple and mango.",
    price: 2.95, dietary: ["vegan"],
  },
  {
    id: "cd7", categoryId: "cold-drinks",
    name: "Red Bull", description: "", price: 2.95, dietary: ["vegan"],
  },
  {
    id: "cd8", categoryId: "cold-drinks",
    name: "Fanta", description: "", price: 2.45, dietary: ["vegan"],
  },
  {
    id: "cd9", categoryId: "cold-drinks",
    name: "Iced Tea", description: "", price: 2.99, dietary: ["vegan"],
  },
  {
    id: "cd10", categoryId: "cold-drinks",
    name: "Iced Coffee", description: "", price: 3.20, dietary: ["vegetarian"],
  },
  {
    id: "cd11", categoryId: "cold-drinks",
    name: "Freshly Squeezed Orange Juice", description: "", price: 3.70, dietary: ["vegan"],
  },
  {
    id: "cd12", categoryId: "cold-drinks",
    name: "Time Homemade Lemonade", description: "", price: 2.95, dietary: ["vegan"],
  },

  /* ── MILKSHAKES ────────────────────────────── */
  {
    id: "ms1", categoryId: "milkshakes",
    name: "Novelty Milkshake with Chocolate Bar of Choice", description: "", price: 4.95, dietary: ["vegetarian"],
  },
  {
    id: "ms2", categoryId: "milkshakes",
    name: "Biscoff Milkshake", description: "", price: 4.95, dietary: ["vegetarian"],
  },
  {
    id: "ms3", categoryId: "milkshakes",
    name: "Banana and Honey Milkshake", description: "", price: 4.45, dietary: ["vegetarian"],
  },
  {
    id: "ms4", categoryId: "milkshakes",
    name: "Strawberry, Chocolate, Vanilla or Banana Milkshake", description: "", price: 4.45, dietary: ["vegetarian"],
  },

  /* ── BEERS ────────────────────────────── */
  {
    id: "br1", categoryId: "beers",
    name: "Budweiser", description: "", price: 3.99, dietary: [],
  },
  {
    id: "br2", categoryId: "beers",
    name: "Kopparberg Mixed Fruits", description: "", price: 3.99, dietary: [],
  },
  {
    id: "br3", categoryId: "beers",
    name: "San Miguel", description: "", price: 3.99, dietary: [],
  },
  {
    id: "br4", categoryId: "beers",
    name: "Stella Artois", description: "", price: 4.50, dietary: [],
  },
  {
    id: "br5", categoryId: "beers",
    name: "Kopparberg Strawberry and Lime", description: "", price: 3.99, dietary: [],
  },
  {
    id: "br6", categoryId: "beers",
    name: "Draft Beer Half Pint", description: "", price: 2.80, dietary: [],
  },

  /* ── SHOTS ────────────────────────────── */
  {
    id: "sh1", categoryId: "shots",
    name: "Scotch Whiskey", description: "", price: 3.99, dietary: [],
  },
  {
    id: "sh2", categoryId: "shots",
    name: "Vodka", description: "", price: 3.99, dietary: [],
  },
  {
    id: "sh3", categoryId: "shots",
    name: "Jack Daniels", description: "", price: 3.99, dietary: [],
  },
  {
    id: "sh4", categoryId: "shots",
    name: "Baileys", description: "", price: 3.99, dietary: [],
  },
  {
    id: "sh5", categoryId: "shots",
    name: "Brandy", description: "", price: 3.99, dietary: [],
  },

  /* ── WINES ────────────────────────────── */
  // Base price = 175ml (200ml for Prosecco); the 250ml / Bottle options add the
  // site's price gap for that pour.
  {
    id: "wn1", categoryId: "wines",
    name: "White Wine — Barefoot",
    description: "",
    price: 4.99, dietary: [],
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "175", label: "175ml", price: 0 },
          { id: "250", label: "250ml", price: 1.00 },
          { id: "bottle", label: "Bottle", price: 12.00 },
        ]
      },
    ],
  },
  {
    id: "wn2", categoryId: "wines",
    name: "White Wine — Gallo",
    description: "",
    price: 3.99, dietary: [],
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "175", label: "175ml", price: 0 },
          { id: "250", label: "250ml", price: 1.00 },
          { id: "bottle", label: "Bottle", price: 10.00 },
        ]
      },
    ],
  },
  {
    id: "wn3", categoryId: "wines",
    name: "White Wine — Echo Falls",
    description: "",
    price: 3.99, dietary: [],
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "175", label: "175ml", price: 0 },
          { id: "250", label: "250ml", price: 1.00 },
          { id: "bottle", label: "Bottle", price: 11.00 },
        ]
      },
    ],
  },
  {
    id: "wn4", categoryId: "wines",
    name: "Rosé — Gallo",
    description: "",
    price: 3.99, dietary: [],
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "175", label: "175ml", price: 0 },
          { id: "250", label: "250ml", price: 1.00 },
          { id: "bottle", label: "Bottle", price: 11.00 },
        ]
      },
    ],
  },
  {
    id: "wn5", categoryId: "wines",
    name: "Rosé — Echo Falls",
    description: "",
    price: 3.99, dietary: [],
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "175", label: "175ml", price: 0 },
          { id: "250", label: "250ml", price: 1.00 },
          { id: "bottle", label: "Bottle", price: 10.00 },
        ]
      },
    ],
  },
  {
    id: "wn6", categoryId: "wines",
    name: "Rosé — Barefoot",
    description: "",
    price: 3.99, dietary: [],
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "175", label: "175ml", price: 0 },
          { id: "250", label: "250ml", price: 1.00 },
          { id: "bottle", label: "Bottle", price: 11.00 },
        ]
      },
    ],
  },
  {
    id: "wn7", categoryId: "wines",
    name: "Rosé — Campo Viejo Rioja",
    description: "",
    price: 4.99, dietary: [],
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "175", label: "175ml", price: 0 },
          { id: "250", label: "250ml", price: 1.00 },
          { id: "bottle", label: "Bottle", price: 12.00 },
        ]
      },
    ],
  },
  {
    id: "wn8", categoryId: "wines",
    name: "Red Wine — Gallo",
    description: "",
    price: 3.99, dietary: [],
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "175", label: "175ml", price: 0 },
          { id: "250", label: "250ml", price: 1.50 },
          { id: "bottle", label: "Bottle", price: 12.00 },
        ]
      },
    ],
  },
  {
    id: "wn9", categoryId: "wines",
    name: "Red Wine — Echo Falls",
    description: "",
    price: 3.99, dietary: [],
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "175", label: "175ml", price: 0 },
          { id: "250", label: "250ml", price: 1.00 },
          { id: "bottle", label: "Bottle", price: 10.00 },
        ]
      },
    ],
  },
  {
    id: "wn10", categoryId: "wines",
    name: "Red Wine — Barefoot",
    description: "",
    price: 3.99, dietary: [],
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "175", label: "175ml", price: 0 },
          { id: "250", label: "250ml", price: 1.00 },
          { id: "bottle", label: "Bottle", price: 11.00 },
        ]
      },
    ],
  },
  {
    id: "wn11", categoryId: "wines",
    name: "Red Wine — Oyster Bay",
    description: "",
    price: 4.99, dietary: [],
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "175", label: "175ml", price: 0 },
          { id: "250", label: "250ml", price: 1.50 },
          { id: "bottle", label: "Bottle", price: 11.50 },
        ]
      },
    ],
  },
  {
    id: "wn12", categoryId: "wines",
    name: "Prosecco",
    description: "",
    price: 4.99, dietary: [],
    variations: [
      {
        id: "v-serving", name: "Serving", options: [
          { id: "200", label: "200ml", price: 0 },
          { id: "bottle", label: "Bottle", price: 12.51 },
        ]
      },
    ],
  },
];
