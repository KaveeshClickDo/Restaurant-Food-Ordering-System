import { Category, MenuItem } from "@/types";

export const categories: Category[] = [
  { id: "starters",    name: "Starters",          emoji: "🥗" },
  { id: "breads",      name: "Breads & Rice",      emoji: "🫓" },
  { id: "mains-veg",   name: "Vegetarian Mains",   emoji: "🥦" },
  { id: "mains-meat",  name: "Meat & Chicken",     emoji: "🍗" },
  { id: "seafood",     name: "Seafood",             emoji: "🦐" },
  { id: "sides",       name: "Sides",               emoji: "🫙" },
  { id: "desserts",    name: "Desserts",            emoji: "🍮" },
  { id: "drinks",      name: "Drinks",              emoji: "🥤" },
];

export const menuItems: MenuItem[] = [
  /* ── STARTERS ─────────────────────────────────── */
  {
    id: "s1", categoryId: "starters",
    name: "Onion Bhaji",
    description: "Crispy golden fritters made with sliced onions, chickpea batter and aromatic spices.",
    price: 5.50, dietary: ["vegan", "vegetarian", "gluten-free"], popular: true,
    variations: [
      { id: "v-size", name: "Portion size", options: [
        { id: "regular", label: "Regular (4 pcs)", price: 0 },
        { id: "large",   label: "Large (6 pcs)",   price: 2.00 },
      ]},
    ],
    addOns: [
      { id: "ao-mint",   name: "Mint chutney",   price: 0.50 },
      { id: "ao-tamarind", name: "Tamarind dip", price: 0.50 },
    ],
  },
  {
    id: "s2", categoryId: "starters",
    name: "Seekh Kebab",
    description: "Minced lamb skewers seasoned with fresh herbs, grilled over charcoal.",
    price: 7.95, dietary: ["halal"],
    variations: [
      { id: "v-spice", name: "Spice level", options: [
        { id: "mild",   label: "Mild",   price: 0 },
        { id: "medium", label: "Medium", price: 0 },
        { id: "hot",    label: "Hot 🌶️", price: 0 },
      ]},
    ],
    addOns: [
      { id: "ao-raita",  name: "Raita",         price: 0.75 },
      { id: "ao-salad",  name: "Side salad",    price: 1.00 },
    ],
  },
  {
    id: "s3", categoryId: "starters",
    name: "Samosa (2 pcs)",
    description: "Hand-made pastry parcels filled with spiced potatoes and peas, served with chutney.",
    price: 4.50, dietary: ["vegetarian", "vegan"],
    addOns: [
      { id: "ao-mint",     name: "Mint chutney",   price: 0.50 },
      { id: "ao-tamarind", name: "Tamarind dip",   price: 0.50 },
    ],
  },
  {
    id: "s4", categoryId: "starters",
    name: "Chicken Tikka",
    description: "Tender chicken breast marinated in yoghurt and spices, cooked in a clay oven.",
    price: 8.50, dietary: ["halal", "gluten-free"], popular: true,
    variations: [
      { id: "v-spice", name: "Spice level", options: [
        { id: "mild",   label: "Mild",   price: 0 },
        { id: "medium", label: "Medium", price: 0 },
        { id: "hot",    label: "Hot 🌶️", price: 0 },
      ]},
    ],
    addOns: [
      { id: "ao-naan",  name: "Mini naan",  price: 1.50 },
      { id: "ao-raita", name: "Raita",      price: 0.75 },
    ],
  },
  {
    id: "s5", categoryId: "starters",
    name: "Vegetable Spring Rolls (3 pcs)",
    description: "Crispy rolls stuffed with spiced mixed vegetables and glass noodles.",
    price: 5.25, dietary: ["vegetarian", "vegan"],
  },

  /* ── BREADS & RICE ────────────────────────────── */
  {
    id: "b1", categoryId: "breads",
    name: "Plain Naan",
    description: "Soft leavened bread baked fresh in a traditional clay oven.",
    price: 2.75, dietary: ["vegetarian"],
  },
  {
    id: "b2", categoryId: "breads",
    name: "Garlic Butter Naan",
    description: "Naan topped with roasted garlic and herb butter.",
    price: 3.25, dietary: ["vegetarian"], popular: true,
  },
  {
    id: "b3", categoryId: "breads",
    name: "Peshwari Naan",
    description: "Sweet naan stuffed with coconut, almond and raisins.",
    price: 3.50, dietary: ["vegetarian"],
  },
  {
    id: "b4", categoryId: "breads",
    name: "Basmati Rice",
    description: "Fluffy long-grain basmati rice, steamed to perfection.",
    price: 3.00, dietary: ["vegan", "gluten-free"],
  },
  {
    id: "b5", categoryId: "breads",
    name: "Pilau Rice",
    description: "Fragrant saffron-infused rice with whole spices.",
    price: 3.50, dietary: ["vegan", "gluten-free"],
  },
  {
    id: "b6", categoryId: "breads",
    name: "Egg Fried Rice",
    description: "Basmati rice stir-fried with egg, spring onions and spices.",
    price: 4.00, dietary: ["vegetarian", "gluten-free"],
  },

  /* ── VEGETARIAN MAINS ─────────────────────────── */
  {
    id: "mv1", categoryId: "mains-veg",
    name: "Paneer Tikka Masala",
    description: "Cubes of fresh cottage cheese in a rich, creamy tomato sauce with fenugreek.",
    price: 11.95, dietary: ["vegetarian", "halal", "gluten-free"], popular: true,
    variations: [
      { id: "v-spice", name: "Spice level", options: [
        { id: "mild",   label: "Mild",   price: 0 },
        { id: "medium", label: "Medium", price: 0 },
        { id: "hot",    label: "Hot 🌶️", price: 0 },
      ]},
    ],
  },
  {
    id: "mv2", categoryId: "mains-veg",
    name: "Chana Masala",
    description: "Hearty chickpea curry cooked with tangy tomatoes, onions and warming spices.",
    price: 10.50, dietary: ["vegan", "gluten-free", "halal"],
  },
  {
    id: "mv3", categoryId: "mains-veg",
    name: "Dal Makhani",
    description: "Slow-cooked black lentils in a buttery tomato sauce, finished with cream.",
    price: 10.50, dietary: ["vegetarian", "gluten-free"],
  },
  {
    id: "mv4", categoryId: "mains-veg",
    name: "Aloo Gobi",
    description: "Dry-style curry of potatoes and cauliflower with turmeric and cumin.",
    price: 9.95, dietary: ["vegan", "gluten-free", "halal"],
  },
  {
    id: "mv5", categoryId: "mains-veg",
    name: "Saag Paneer",
    description: "Fresh spinach and cottage cheese cooked with garlic, ginger and spices.",
    price: 11.50, dietary: ["vegetarian", "gluten-free"],
  },

  /* ── MEAT & CHICKEN ───────────────────────────── */
  {
    id: "mc1", categoryId: "mains-meat",
    name: "Chicken Tikka Masala",
    description: "Britain's favourite — tender tikka chicken in a velvety spiced tomato cream sauce.",
    price: 13.50, dietary: ["halal", "gluten-free"], popular: true,
    variations: [
      { id: "v-spice", name: "Spice level", options: [
        { id: "mild",   label: "Mild",   price: 0 },
        { id: "medium", label: "Medium", price: 0 },
        { id: "hot",    label: "Hot 🌶️", price: 0 },
      ]},
    ],
    addOns: [
      { id: "ao-rice",  name: "Add basmati rice",  price: 3.00 },
      { id: "ao-naan",  name: "Add plain naan",    price: 2.75 },
    ],
  },
  {
    id: "mc2", categoryId: "mains-meat",
    name: "Lamb Rogan Josh",
    description: "Slow-braised Kashmiri lamb in a deep red sauce of dried chillies and whole spices.",
    price: 14.95, dietary: ["halal", "gluten-free"],
    variations: [
      { id: "v-spice", name: "Spice level", options: [
        { id: "mild",   label: "Mild",   price: 0 },
        { id: "medium", label: "Medium", price: 0 },
        { id: "hot",    label: "Hot 🌶️", price: 0 },
      ]},
    ],
  },
  {
    id: "mc3", categoryId: "mains-meat",
    name: "Butter Chicken",
    description: "Mild, rich and aromatic — grilled chicken in a luscious butter-tomato sauce.",
    price: 13.50, dietary: ["halal", "gluten-free"], popular: true,
  },
  {
    id: "mc4", categoryId: "mains-meat",
    name: "Chicken Biryani",
    description: "Fragrant basmati layered with slow-cooked chicken and caramelised onions. Served with raita.",
    price: 14.50, dietary: ["halal", "gluten-free"],
    variations: [
      { id: "v-spice", name: "Spice level", options: [
        { id: "mild",   label: "Mild",   price: 0 },
        { id: "medium", label: "Medium", price: 0 },
        { id: "hot",    label: "Hot 🌶️", price: 0 },
      ]},
    ],
  },
  {
    id: "mc5", categoryId: "mains-meat",
    name: "Lamb Keema Curry",
    description: "Minced lamb cooked with peas, tomatoes and fresh ginger.",
    price: 13.95, dietary: ["halal", "gluten-free"],
  },

  /* ── SEAFOOD ──────────────────────────────────── */
  {
    id: "sf1", categoryId: "seafood",
    name: "King Prawn Masala",
    description: "Juicy king prawns in a spiced onion and tomato masala. A house classic.",
    price: 16.95, dietary: ["halal", "gluten-free"], popular: true,
    variations: [
      { id: "v-spice", name: "Spice level", options: [
        { id: "mild",   label: "Mild",   price: 0 },
        { id: "medium", label: "Medium", price: 0 },
        { id: "hot",    label: "Hot 🌶️", price: 0 },
      ]},
    ],
  },
  {
    id: "sf2", categoryId: "seafood",
    name: "Prawn Biryani",
    description: "Fragrant long-grain rice cooked with whole spices and succulent prawns.",
    price: 15.50, dietary: ["gluten-free"],
  },
  {
    id: "sf3", categoryId: "seafood",
    name: "Fish Curry",
    description: "Cod fillet in a tangy mustard and coconut milk sauce.",
    price: 14.95, dietary: ["gluten-free"],
  },

  /* ── SIDES ────────────────────────────────────── */
  {
    id: "si1", categoryId: "sides",
    name: "Mixed Raita",
    description: "Cooling yoghurt with cucumber, mint and a pinch of cumin.",
    price: 2.50, dietary: ["vegetarian", "gluten-free"],
  },
  {
    id: "si2", categoryId: "sides",
    name: "Mango Chutney",
    description: "Sweet and tangy house-made mango preserve.",
    price: 1.50, dietary: ["vegan", "gluten-free"],
  },
  {
    id: "si3", categoryId: "sides",
    name: "Pickled Onion Salad",
    description: "Red onions marinated with lemon juice, chilli and fresh coriander.",
    price: 2.00, dietary: ["vegan", "gluten-free"],
  },
  {
    id: "si4", categoryId: "sides",
    name: "Papadum (2 pcs) with Chutneys",
    description: "Crispy lentil wafers served with mint and tamarind dip.",
    price: 2.50, dietary: ["vegan", "gluten-free"],
  },

  /* ── DESSERTS ─────────────────────────────────── */
  {
    id: "d1", categoryId: "desserts",
    name: "Gulab Jamun (2 pcs)",
    description: "Soft milk-solid dumplings soaked in rose-flavoured sugar syrup.",
    price: 4.50, dietary: ["vegetarian"],
    addOns: [{ id: "ao-cream", name: "Clotted cream", price: 1.00 }],
  },
  {
    id: "d2", categoryId: "desserts",
    name: "Mango Kulfi",
    description: "Traditional Indian ice cream made with condensed milk and Alphonso mango.",
    price: 4.95, dietary: ["vegetarian", "gluten-free"], popular: true,
  },
  {
    id: "d3", categoryId: "desserts",
    name: "Kheer",
    description: "Creamy rice pudding infused with saffron, cardamom and rose water.",
    price: 4.50, dietary: ["vegetarian", "gluten-free"],
  },

  /* ── DRINKS ───────────────────────────────────── */
  {
    id: "dr1", categoryId: "drinks",
    name: "Mango Lassi",
    description: "Chilled yoghurt drink blended with Alphonso mango pulp.",
    price: 3.95, dietary: ["vegetarian", "gluten-free"],
    variations: [
      { id: "v-size", name: "Size", options: [
        { id: "regular", label: "Regular (330ml)", price: 0 },
        { id: "large",   label: "Large (500ml)",   price: 1.50 },
      ]},
    ],
  },
  {
    id: "dr2", categoryId: "drinks",
    name: "Sweet Lassi",
    description: "Classic chilled yoghurt drink, lightly sweetened.",
    price: 3.50, dietary: ["vegetarian", "gluten-free"],
  },
  {
    id: "dr3", categoryId: "drinks",
    name: "Masala Chai",
    description: "Spiced black tea brewed with milk, ginger, cardamom and cinnamon.",
    price: 2.75, dietary: ["vegetarian", "gluten-free"],
  },
  {
    id: "dr4", categoryId: "drinks",
    name: "Still Water (500ml)",
    description: "Still mineral water.", price: 1.50, dietary: ["vegan", "gluten-free"],
  },
  {
    id: "dr5", categoryId: "drinks",
    name: "Sparkling Water (330ml)",
    description: "Sparkling mineral water.", price: 1.50, dietary: ["vegan", "gluten-free"],
  },
  {
    id: "dr6", categoryId: "drinks",
    name: "Soft Drink",
    description: "Choose from Coke, Diet Coke, Sprite or Fanta.",
    price: 2.00, dietary: ["vegan"],
    variations: [
      { id: "v-type", name: "Flavour", options: [
        { id: "coke",      label: "Coca-Cola",  price: 0 },
        { id: "diet-coke", label: "Diet Coke",  price: 0 },
        { id: "sprite",    label: "Sprite",     price: 0 },
        { id: "fanta",     label: "Fanta",      price: 0 },
      ]},
    ],
  },
];
