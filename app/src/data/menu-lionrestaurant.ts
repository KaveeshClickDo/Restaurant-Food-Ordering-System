import { Category, MealPeriod, MenuItem } from "@/types";

export const categories: Category[] = [
  // --- Parent Categories ---
  { id: "parent-sri-lankan", name: "Sri Lankan Menu", emoji: "🍛" },
  { id: "parent-japanese", name: "Japanese Menu", emoji: "🍱" },
  { id: "parent-sushi", name: "Lion Sushi", emoji: "🍣" },

  // Sri Lankan categories
  { id: "starters", name: "Starters", emoji: "🥟", parentId: "parent-sri-lankan" },
  { id: "fried-rice", name: "Fried Rice", emoji: "🍚", parentId: "parent-sri-lankan" },
  { id: "curries", name: "Curries", emoji: "🍛", parentId: "parent-sri-lankan" },
  { id: "devils", name: "Devils", emoji: "🍗", parentId: "parent-sri-lankan" },
  { id: "crab-specials", name: "Crab Specials", emoji: "🦀", parentId: "parent-sri-lankan" },
  { id: "kottu", name: "Kottu", emoji: "🥘", parentId: "parent-sri-lankan" },
  { id: "sides", name: "Sides", emoji: "🥗", parentId: "parent-sri-lankan" },
  { id: "kids-menu", name: "Kids Menu", emoji: "🍟", parentId: "parent-sri-lankan" },
  { id: "desserts", name: "Desserts", emoji: "🍰", parentId: "parent-sri-lankan" },

  // Japanese categories
  { id: "starters-ja", name: "Starters", emoji: "🥢", parentId: "parent-japanese" },
  { id: "tempura", name: "Tempura", emoji: "🍤", parentId: "parent-japanese" },
  { id: "seafood", name: "Seafood", emoji: "🦐", parentId: "parent-japanese" },
  { id: "meats", name: "Meats", emoji: "🥩", parentId: "parent-japanese" },
  { id: "sides-ja", name: "Sides", emoji: "🥗", parentId: "parent-japanese" },
  { id: "donburi", name: "Donburi", emoji: "🍱", parentId: "parent-japanese" },
  { id: "curries-ja", name: "Curries", emoji: "🍛", parentId: "parent-japanese" },
  { id: "teppanyaki", name: "Teppanyaki", emoji: "🍜", parentId: "parent-japanese" },

  // Sushi categories
  { id: "temaki", name: "Temaki", emoji: "🌯", parentId: "parent-sushi" },
  { id: "platters", name: "Platters", emoji: "🍱", parentId: "parent-sushi" },
  { id: "maki", name: "Maki", emoji: "🍥", parentId: "parent-sushi" },
];

// Two sensible defaults. Admin can rename, edit times, add more periods, or
// delete them entirely. Items reference these IDs in their mealPeriodIds list.
export const mealPeriods: MealPeriod[] = [
  {
    id: "mp-breakfast", name: "Breakfast",
    enabled: true, startTime: "07:00", endTime: "11:30",
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    sortOrder: 0,
    themeColor: "#f59e0b", // Amber-500
  },
  {
    id: "mp-dinner", name: "Dinner",
    enabled: true, startTime: "17:00", endTime: "22:00",
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    sortOrder: 1,
    themeColor: "#1c0b03", // Emerald-500
  },
];

export const menuItems: MenuItem[] = [
  // Seeed data for Sri Lankan menu items.

  /* ── STARTERS ─────────────────────────────────── */
  // A handful of items below are decorated with the new POS-side fields
  // (cost/sku/emoji/color/active/offer) so the demo seed shows what a
  // fully-configured item looks like in both editors. Other items leave
  // these undefined to confirm the defaults still work.
  {
    id: "s1", categoryId: "starters",
    name: "Fish Cutlets",
    description: "Sri Lankan style fish cakes filled with a fried mixture of mackerel with mash potatoes, onions, green chilli, curry leaves & pepper, coated in breadcrumbs and deep fried.",
    price: 5.50, dietary: ["halal"], popular: true,
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/ef8f7ad3-eaf2-4070-a260-a01562a041f4.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (3 pcs)", price: 0 },
        ]
      },
    ],
  },
  {
    id: "s2", categoryId: "starters",
    name: "Mutton/Chicken Rolls",
    description: "Mixture of mutton or chicken flavoured with Sri lankan spices, wrapped in a pancake, coated in breadcrumbs and deep fried.",
    price: 6.50, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/648d76a7-6f0a-465f-a217-c0e3e04a5308.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (2 pcs)", price: 0 },
        ]
      },
    ],
  },
  {
    id: "s3", categoryId: "starters",
    name: "Samosa",
    description: "Crispy, golden-fried pastry pockets filled with your choice of savory spiced vegetables or seasoned minced meat. A classic South Asian starter perfect for sharing.",
    price: 5.50, dietary: ["vegetarian", "halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/b8bfd9a7-7377-4c5a-b594-e50183c560ad.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (2 pcs)", price: 0 },
        ]
      },
      {
        id: "v-type", name: "Choose Filling", options: [
          { id: "vegetable", label: "Vegetable", price: 0 },
          { id: "meat", label: "Meat", price: 0 },
        ]
      },
    ],
  },
  {
    id: "s4", categoryId: "starters",
    name: "Coconut Roti",
    description: "Sri Lankan style flat bread made with fresh coconut served with seeni sambol (Onions fried with a mix of spices, chili flakes and a hint of sugar).",
    price: 6.00, dietary: ["vegan"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/b2aa93a1-e092-498a-a527-3c777031e902.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (2 pcs)", price: 0 },
        ]
      },
    ],
  },
  {
    id: "s5", categoryId: "starters",
    name: "Chilli Chicken Lolipop",
    description: "Crispy Chicken drumsticks marinated in Sri Lankan spices and chilli, served with spicy mayo.",
    price: 9.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/ed37f97c-7519-488e-9fa9-ef34a2ccd37c.jpeg",
  },


  /* ── FRIED RICE ────────────────────────────── */
  {
    id: "fr1", categoryId: "fried-rice",
    name: "Lion's Special",
    description: "Chef’s special rice with chicken, pork, beef, prawns, squids & vegetable stir fried mixed with Chef’s special spicy mix.",
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/741e317c-a009-4692-a50b-f69f27514595.jpeg",
    price: 14.95, dietary: [],
  },
  {
    id: "fr2", categoryId: "fried-rice",
    name: "Seafood Fried Rice",
    description: "Prawns, Squid, vegetables & crab sticks",
    price: 13.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/6a910ac7-a949-4fa7-a249-3bdf13eb0d2c.jpeg",
  },
  {
    id: "fr3", categoryId: "fried-rice",
    name: "Egg Fried Rice",
    description: "Eggs & an array of vegetable",
    price: 8.95, dietary: ["vegan"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/394bebdd-4144-4abb-9a50-d658bc81c0b1.jpeg",
  },
  {
    id: "fr4", categoryId: "fried-rice",
    name: "Chicken Fried Rice",
    description: "Chicken & an array of vegetables",
    price: 11.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/2e055b76-5e78-4a35-a3bd-d2829d740ead.jpeg",
  },
  {
    id: "fr5", categoryId: "fried-rice",
    name: "Beef Fried Rice",
    description: "Beef & an array of vegetables",
    price: 12.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/be79a151-70e3-49b0-ad33-fd8c3bb92dc3.jpeg",
  },


  /* ── CURRIES ────────────────────────────── */
  {
    id: "c1", categoryId: "curries",
    name: "Annasi Maaluwa",
    description: "Mixed Vegetables are cooked in coconut milk and infused with Sri Lankan authentic spices",
    price: 6.95, dietary: ["vegan"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/ff70e7ce-90fc-4035-ac69-a5c53254b394.jpeg"
  },
  {
    id: "c2", categoryId: "curries",
    name: "Chicken Curry",
    description: "Chicken on the bone cooked with a mix of Sri Lankan spices.",
    price: 10.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/aab93343-2211-4855-9b26-7534bd3b885a.jpeg"
  },
  {
    id: "c3", categoryId: "curries",
    name: "Dhal Curry",
    description: "Juicy pineapple chunks cooked in coconut milk and infused with sri lankan authentic spices.",
    price: 7.95, dietary: ["vegetarian"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/0590e43d-1449-4fae-97b7-db78e21c6b6e.jpeg"
  },
  {
    id: "c4", categoryId: "curries",
    name: "Kaju Maaluwa",
    description: "Soaked cashews and peas cooked in rich coconut cream.",
    price: 8.95, dietary: ["vegan"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/fb57cd64-cfa8-4cd3-b438-50ef8a2312e0.jpeg"
  },
  {
    id: "c5", categoryId: "curries",
    name: "Polos Curry(Baby jackfruit curry)",
    description: "Unriped jackfruit seasoned with variety of Sri Lankan spices, cooked in creamy coconut milk for a flavor base.",
    price: 8.95, dietary: ["vegetarian"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/7e818533-621f-4c54-a88d-900b1ee1e8ef.jpeg"
  },
  {
    id: "c6", categoryId: "curries",
    name: "Salmon Curry",
    description: "Salmon fish cooked in rich coconut milk bursting with flavours of pandan leaves, curry leaves, cardamon and mix of spices.",
    price: 11.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/6cdc13f2-b2f1-42cf-a2c5-99f4a8d5dccb.jpeg"
  },
  {
    id: "c7", categoryId: "curries",
    name: "Lamb Curry",
    description: "Slow cooked boneless lamb in special roast spices",
    price: 11.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/ba954f13-7b00-422e-913b-fb3eb7e54bc4.jpeg"
  },
  {
    id: "c8", categoryId: "curries",
    name: "Prawn Curry",
    description: "Shrimps are cooked in rich coconut milk with a mix of Sri Lankan spices",
    price: 10.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/f8adb5c7-e991-4903-b659-f26b100682de.jpeg"
  },
  {
    id: "c9", categoryId: "curries",
    name: "Black Pork Curry",
    description: "Pork cooked with a mix of Sri Lanka Spices, the colour is derived from a dark roasted curry powder",
    price: 10.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/3b4f9cba-1134-4bd0-8f8e-2b3cca5df006.jpeg"
  },


  /* ── DEVILS ────────────────────────────── */
  {
    id: "d1", categoryId: "devils",
    name: "Chicken Devil",
    description: "Spicy stir-fried chicken with onions, peppers, and a fiery devil sauce.",
    price: 12.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/e194af86-869a-410d-8a13-2f6f4557f3da.jpeg"
  },
  {
    id: "d2", categoryId: "devils",
    name: "Beef Devil",
    description: "Tender beef tossed with vegetables in a rich, spicy devil-style sauce.",
    price: 13.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/363df664-3aa9-41f9-86d1-92eb13e4be8f.jpeg"
  },
  {
    id: "d3", categoryId: "devils",
    name: "Pork Devil",
    description: "Juicy pork stir-fried with peppers and onions in a hot and savory sauce.",
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/1a2f8e29-a0c4-441a-90a4-e3468b839783.jpeg",
    price: 12.95, dietary: [],
  },
  {
    id: "d4", categoryId: "devils",
    name: "Prawn Devil",
    description: "Succulent prawns cooked with vegetables and a bold spicy devil seasoning.",
    price: 14.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/8f03d6a5-afd9-4cd9-94d0-1b97f25e425a.jpeg"
  },
  {
    id: "d5", categoryId: "devils",
    name: "Mix Devil",
    description: "A flavorful combination of chicken, beef, pork, and prawns in spicy devil sauce.",
    price: 16.95, dietary: ["mix"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/bceebb67-1055-482d-9fd8-763290bb1e29.jpeg"
  },
  {
    id: "d6", categoryId: "devils",
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/4c4692ed-f89c-4771-900f-bc8fe0928a31.jpeg",
    name: "Vegetable Devil",
    description: "Fresh mixed vegetables stir-fried with peppers and a spicy devil-style sauce.",
    price: 11.95, dietary: ["vegetarian"],
  },


  /* ── CRAB SPECIALS ────────────────────────────── */
  {
    id: "cs1", categoryId: "crab-specials",
    name: "Salt & Pepper Crab",
    description: "Crab made from hand crushed peppercorn and pepper stock, fusing two ingredients endemic to Sri lanka.",
    price: 14.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/0ad079a7-21e8-4cb5-bb77-a1da91f98b58.jpeg"
  },
  {
    id: "cs2", categoryId: "crab-specials",
    name: "Garlic & Chilli Crab",
    description: "The iconic style of crab eaten in South Asia, our version includes a variety of zingy flavours to create the perfect taste.",
    price: 15.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/4d9e7696-be88-4bb7-899c-10cd8df295c7.jpeg"
  },
  {
    id: "cs3", categoryId: "crab-specials",
    name: "Crab Curry",
    description: "A traditional sri lankan crab curry cooked in coconut milk and an array of spices",
    price: 16.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/06ff9a2f-0b03-447d-be97-af08bd0c3474.jpeg"
  },


  /* ── KOTTU ────────────────────────────── */
  {
    id: "k1", categoryId: "kottu",
    name: "Seafood Kottu",
    description: "Chopped roti stir-fried with mixed seafood, vegetables, and aromatic spice",
    price: 14.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/57cde264-dacf-48e0-82df-3bcf2bd4634e.jpeg"
  },
  {
    id: "k2", categoryId: "kottu",
    name: "Chicken Kottu",
    description: "Sri Lankan chopped roti tossed with chicken, vegetables, and savory spices.",
    price: 12.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/af4973a8-78ee-4c7f-a78b-ee177d99c29d.jpeg"
  },
  {
    id: "k3", categoryId: "kottu",
    name: "Mutton Kottu",
    description: "Flavorful chopped roti cooked with tender mutton, vegetables, and spices.",
    price: 13.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/44275ba2-7838-4e10-9290-ad1771be27ce.jpeg"
  },
  {
    id: "k4", categoryId: "kottu",
    name: "Veggie Kottu",
    description: "Chopped roti stir-fried with fresh vegetables and a blend of traditional spices.",
    price: 10.95, dietary: ["vegetarian"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/c2457750-257a-4d0f-ab1a-f9c386cf10c5.jpeg"
  },


  /* ── SIDES ────────────────────────────── */
  {
    id: "si1", categoryId: "sides",
    name: "Coconut Sambol",
    description: "Grated fresh coconut blended with chilli flakes, onions, green chillies and black pepper",
    price: 6.95, dietary: ["vegan", "vegetarian"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/97215b19-ff7a-45e8-9d34-f52b28781838.jpeg"
  },
  {
    id: "si2", categoryId: "sides",
    name: "Paratha Roti",
    description: "Sri Lankan style flat bread.",
    price: 5.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/8669b984-cd0b-49df-96db-3ff139e01444.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (2 pcs)", price: 0 },
        ]
      },
    ],

  },
  {
    id: "si3", categoryId: "sides",
    name: "Papadoms 3pcs",
    description: "Crispy, light lentil crackers served as a tasty starter or side.",
    price: 3.95, dietary: ["vegan"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/af941e05-afd8-4ab8-a87e-58a797c58d89.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (3 pcs)", price: 0 },
        ]
      },
    ],
  },
  {
    id: "si4", categoryId: "sides",
    name: "Chips",
    description: "Golden crispy fries, perfectly seasoned and served hot.",
    price: 6.95, dietary: ["vegan"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/cb4ee5b4-22ea-44c6-bfa6-bf4e6ff3684d.jpeg"
  },

  /* ── KIDS MENU ────────────────────────────── */
  {
    id: "km1", categoryId: "kids-menu",
    name: "Chicken Katsu with Curry Sauce",
    description: "Chicken breast coated in crispy panko bread crumbs Served with sticky white rice and Curry Sauce.",
    price: 8.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/d6edbaae-a1e7-4224-8dbc-e54a965c6bb1.jpg",
    variations: [
      {
        id: "v-size", name: "Size", options: [
          { id: "mini", label: "Mini", price: 0 },
        ]
      },
    ],
  },
  {
    id: "km2", categoryId: "kids-menu",
    name: "Yasai Yaki Soba",
    description: "Thin noodles, vegetables and chicken mixed with sweet teriyaki sauce.",
    price: 8.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/d1569f98-ea7a-4990-ac89-b59985c5c55b.jpeg",
    variations: [
      {
        id: "v-size", name: "Size", options: [
          { id: "mini", label: "Mini", price: 0 },
        ]
      },
    ],
  },
  {
    id: "km3", categoryId: "kids-menu",
    name: "Chicken Fried Rice",
    description: "stir fried white rice mixed with chicken and vegetable with light flavoured sri lankan spices",
    price: 8.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/7dca888d-516e-40d6-bb17-00250bda8290.jpeg"
  },
  {
    id: "km4", categoryId: "kids-menu",
    name: "Chicken Nuggets and Chips",
    description: "Crispy chicken nuggets served with golden fries.",
    price: 8.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/496232dd-1b74-4971-99a2-98df56b2463e.jpeg"
  },


  /* ── DESSERTS ────────────────────────────── */
  {
    id: "ds1", categoryId: "desserts",
    name: "Carrot Cake",
    description: "Moist spiced carrot cake with a delicious vg finish.",
    price: 5.95, dietary: ["vegan"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/78621017-0b70-419c-bbbc-837fe19bfcbc.jpeg"
  },
  {
    id: "ds2", categoryId: "desserts",
    name: "Mochi",
    description: "Soft and chewy Japanese rice cake with a sweet filling.",
    price: 5.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/7ee60376-cc03-4f70-9ff6-89e5b9bcb1e0.jpeg"
  },
  {
    id: "ds3", categoryId: "desserts",
    name: "Chocolate Fudge Cake",
    description: "Rich chocolate sponge layered with indulgent fudge icing.",
    price: 5.90, dietary: ["vegetarian"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/fe53b8e6-1850-48b5-94e3-377ea21245bf.jpeg"
  },
  {
    id: "ds4", categoryId: "desserts",
    name: "Banana Tempura",
    description: "Lightly battered banana, fried until golden and crisp.",
    price: 6.95, dietary: ["vegetarian"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/5a99a493-0e4d-4387-9e94-e40de4e0f90a.jpeg"
  },
  {
    id: "ds5", categoryId: "desserts",
    name: "Ice Cream",
    description: "Smooth and creamy ice cream, served chilled.",
    price: 5.75, dietary: ["vegetarian"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/e6eee371-3066-4425-9472-ef80d506f99d.jpeg"
  },
  {
    id: "ds6", categoryId: "desserts",
    name: "Ice Cream Tempura",
    description: "Crispy fried coating with a cold, creamy ice cream center.",
    price: 7.95, dietary: ["vegetarian"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/cb6a2ca4-5d00-4817-9eb4-2cb487ecdd1f.jpeg"
  },
  {
    id: "ds7", categoryId: "desserts",
    name: "Wattalapam",
    description: "Traditional Sri Lankan coconut custard dessert infused with spices.",
    price: 6.95, dietary: ["vegetarian"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/10e73a97-25e3-4016-81e6-515f53f61e25.jpeg"
  },



  // More items can be added here for the Japanese menu.

  /* ── STARTERS - JAPANESE ────────────────────────────── */
  {
    id: "js1", categoryId: "starters-ja",
    name: "Edamame",
    description: "Edamame beans seasoned with salt or chilli garlic",
    price: 7.95, dietary: ["vegan"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/5d98cd43-4daa-4ef1-a645-3350ca96f66f.jpeg"
  },
  {
    id: "js2", categoryId: "starters-ja",
    name: "Seafood Korokke",
    description: "Freshly Made fish cake drizzled With delicious fruity tonkatsu sauce",
    price: 8.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/e15cd758-bbc6-44d3-a472-4ffb43799839.jpeg"
  },
  {
    id: "js3", categoryId: "starters-ja",
    name: "Ebi Karaage",
    description: "Prawns marinated in ginger, garlic & Japanese spices, lightly coated in corn flour and deep fried",
    price: 9.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/ae5455c6-9f6f-4ec6-b659-52bd8f3b75ff.jpeg"
  },
  {
    id: "js4", categoryId: "starters-ja",
    name: "Steak Skewers",
    description: "Skewered steak served with spicy mayonnaise.",
    price: 10.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/f9333190-21d8-466f-979e-60b668903154.jpeg"
  },
  {
    id: "js5", categoryId: "starters-ja",
    name: "Miso Shiru",
    description: "Soybeans, fish stock, seaweed, Tofu & spring onion soup",
    price: 5.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/3a07b8d1-603f-45d8-9d0a-9b08a70ec587.jpeg"
  },
  {
    id: "js6", categoryId: "starters-ja",
    name: "Yakitori",
    description: "Pan-fried, skewered chicken & leeks, slow cooked with teriyaki sauce",
    price: 9.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/da52a674-d5bb-486a-ac52-35bb6141fb9b.jpeg"
  },
  {
    id: "js7", categoryId: "starters-ja",
    name: "Tori Karaage",
    description: "Chicken marinated in ginger, garlic & japanese spices lightly coated in tempura flour deep fried",
    price: 9.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/178f352a-6717-4ac0-a5ad-75620ae10abc.jpeg"
  },
  {
    id: "js8", categoryId: "starters-ja",
    name: "Age Dashi Tofu",
    description: "Golden fried tofu Served with tempura sauce, spring onion & seaweed",
    price: 7.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/92826375-5750-4923-8af6-7bd361276f3a.png"
  },
  {
    id: "js9", categoryId: "starters-ja",
    name: "Mini Vegetable Spring Rolls",
    description: "A variety of vegetables rolled in a fine pastry and fried.",
    price: 7.95, dietary: ["vegan"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/49db1295-8a4e-4681-8b40-ee087ef923e1.jpeg"
  },
  {
    id: "js10", categoryId: "starters-ja",
    name: "Chicken Wings",
    description: "Seasoned crispy Chicken wings fried in corn flour and served with spicy mayo or ketchup",
    price: 9.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/d2085ee2-0e40-40ad-8cb0-399b07c0c4f8.jpeg"
  },
  {
    id: "js11", categoryId: "starters-ja",
    name: "Gyoza",
    description: "Chicken stuffed dumplings steamed or fried.",
    price: 8.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/f0161466-7d88-48b2-a69a-3072658d0e08.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (5 pcs)", price: 0 },
        ]
      },
    ],
  },
  {
    id: "js12", categoryId: "starters-ja",
    name: "Beef teriyaki",
    description: "Deep fried crispy strips of beef tossed insweet teriyaki sauce, onion, cucumber, sesame seeds.",
    price: 10.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/0635c020-e567-40ad-8185-3291c08a76e5.jpeg"
  },


  /* ── TEMPURA ────────────────────────────── */
  {
    id: "t1", categoryId: "tempura",
    name: "Ebi Tempura - Prawns",
    description: "Lightly battered prawns fried until golden and crispy.",
    price: 11.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/4a6665ee-98c7-429c-94b3-05ef8fb4ce69.jpeg"
  },
  {
    id: "t2", categoryId: "tempura",
    name: "Yasai - Assorted Vegetables",
    description: "Assorted fresh vegetables in a light, crispy tempura batter.",
    price: 9.95, dietary: ["vegan"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/51d99538-6d22-4e5c-8628-b8f721d93f7d.jpeg"
  },
  {
    id: "t3", categoryId: "tempura",
    name: "Ika Tempura - Calamari",
    description: "Tender calamari coated in tempura batter and fried to perfection.",
    price: 10.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/f5130a02-e28f-4bf9-b7f6-f9a84484f392.jpeg"
  },
  {
    id: "t4", categoryId: "tempura",
    name: "Kani Tempura - Soft Shell Crab",
    description: "Crispy soft shell crab served in a delicate tempura coating.",
    price: 10.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/f892bebc-fb6a-4818-9d71-0a7cc59971f9.jpeg"
  },
  {
    id: "t5", categoryId: "tempura",
    name: "Mixed Seafood Tempura",
    description: "A selection of seafood lightly battered and fried until crisp.",
    price: 13.95, dietary: ["mix"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/38a8bfad-1cf0-4442-b0c3-351010797c53.jpeg"
  },


  /* ── SEAFOOD - JAPANESE ────────────────────────────── */
  {
    id: "sf1", categoryId: "seafood",
    name: "Squid - Ika",
    description: "Fresh squid prepared with authentic Japanese flavors.",
    price: 16.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/c1f4d1c5-1f83-4233-883c-118f2e6d30ee.jpeg"
  },
  {
    id: "sf2", categoryId: "seafood",
    name: "Salmon - Sake",
    description: "cook with teriyaki sauce / garlic,butter,soy sauce",
    price: 19.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/bbeec830-4ed3-4e47-b9ab-de1ed1f81799.jpeg"
  },
  {
    id: "sf3", categoryId: "seafood",
    name: "Sea Bass - Suzuki",
    description: "Mild and flaky sea bass with a clean, delicate taste.",
    price: 19.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/2694037d-7c99-41bf-ad14-dc8368f60881.jpeg"
  },
  {
    id: "sf4", categoryId: "seafood",
    name: "Prawns - Ebi",
    description: "Succulent prawns prepared in traditional Japanese style.",
    price: 18.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/d67f3d80-e565-4924-953e-def6a1d4f59f.jpeg"
  },


  /* ── MEATS - JAPANESE ────────────────────────────── */
  {
    id: "m1", categoryId: "meats",
    name: "T Bone Steak",
    description: "Marinde soy sauce, lemon juice, pepper, garlic and red wine",
    price: 25.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/48148dfe-ce9b-40f0-95ad-f99eeb2de071.jpeg"
  },
  {
    id: "m2", categoryId: "meats",
    name: "Chicken Fillet",
    description: "Cooked with teriyaki sauce",
    price: 19.95, dietary: ["halal"],
    image: "https://cdn.apartmenttherapy.info/image/upload/f_jpg,q_auto:eco,c_fill,g_auto,w_1500,ar_1:1/k%2FPhoto%2FRecipes%2F2024-05-chicken-teriyaki-190%2Fchicken-teriyaki-190-171-horizontal"
  },
  {
    id: "m3", categoryId: "meats",
    name: "Fillet Beef",
    description: "Tender beef fillet cooked to highlight its rich flavor.",
    price: 25.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/86c1dbaf-471c-434c-8d99-96cd31ad4bda.jpeg"
  },
  {
    id: "m4", categoryId: "meats",
    name: "Rib Eye Steak",
    description: "Cooked with garlic,butter,soy sauce",
    price: 24.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/beaa2c45-2d1b-44b3-bdb3-e0910871bc8c.jpeg"
  },
  {
    id: "m5", categoryId: "meats",
    name: "Rump of Lamb",
    description: "Cooked with garlic, butter, onion, mushrooms & saysauce",
    price: 21.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/b22f7f92-f416-41f3-9ad8-a6d6a41d7e00.jpeg"
  },
  {
    id: "m6", categoryId: "meats",
    name: "Breast of Duck",
    description: "Cooked with teriyaki sauce",
    price: 22.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/47db793d-f3e9-44df-8d55-c8dae1948d3a.jpg"
  },


  /* ── SIDES - JAPANESE ────────────────────────────── */
  {
    id: "sja1", categoryId: "sides-ja",
    name: "Garlic Mushrooms",
    description: "Mushrooms cooked in garlic butter with soya sauce",
    price: 6.95, dietary: ["vegetarian"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/3ae01068-3aab-4fb4-8160-c21d3a0e601b.jpeg"
  },
  {
    id: "sja2", categoryId: "sides-ja",
    name: "Plain Noodles",
    description: "Plain, Boiled noodles",
    price: 5.95, dietary: ["vegetarian"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/6a87916d-4ee4-43d0-9eed-0409a5665002.jpeg"
  },
  {
    id: "sja3", categoryId: "sides-ja",
    name: "Asparagus",
    description: "Asparagus cooked in garlic butter and soy sauce",
    price: 8.95, dietary: ["vegetarian"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/f6aece24-c69c-4b96-b5b5-62a03b934840.jpeg"
  },
  {
    id: "sja4", categoryId: "sides-ja",
    name: "Japanese Sticky Rice",
    description: "Plain, Boiled Japanese sticky rice",
    price: 5.95, dietary: ["vegan"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/be66f4d0-7d8d-4887-9c13-b8e12bea45f7.jpeg"
  },
  {
    id: "sja5", categoryId: "sides-ja",
    name: "Long Grain Rice",
    description: "Plain, Boiled Long grain rice",
    price: 5.95, dietary: ["vegan"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/bffe1d1e-1a7c-4d0c-a93a-5c60147d3212.jpeg"
  },
  {
    id: "sja6", categoryId: "sides-ja",
    name: "Mushroom Panko-Age",
    description: "Breaded, deep fried mushrooms",
    price: 6.95, dietary: ["vegetarian"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/c1054855-03b4-4669-88e3-dcdbe09e7131.jpeg"
  },
  {
    id: "sja7", categoryId: "sides-ja",
    name: "Spicy Cauliflower",
    description: "BMarinated in light spice",
    price: 6.95, dietary: ["vegan"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/8eea3bcd-487b-42a0-ac89-4b2061e3d7fc.png"
  },


  /* ── DONBURI - JAPANESE ────────────────────────────── */
  {
    id: "db1", categoryId: "donburi",
    name: "Pork Katsu-Don",
    description: "Crispy pork cutlet served over rice with a savory egg topping.",
    price: 13.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/6a11431a-334f-4a31-af51-698330adf028.jpg"
  },
  {
    id: "db2", categoryId: "donburi",
    name: "Chicken Katsu-Don",
    description: "Breaded chicken cutlet served over rice with egg and savory sauce.",
    price: 14.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/1db04b3b-90c5-4147-8e85-3d50e688b89a.png"
  },


  /* ── JAPANESE CURRY ────────────────────────────── */
  {
    id: "jc1", categoryId: "curries-ja",
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/b1369ae6-8a98-4f9e-a0f0-f70bb06c91e6.jpeg",
    name: "Chicken",
    description: "A traditional Japanese chicken curry served with steamed rice.",
    price: 14.95, dietary: ["halal"],
  },
  {
    id: "jc2", categoryId: "curries-ja",
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/c2bd226e-7fbc-42c9-9371-95a85fd4b0fe.jpeg",
    name: "Pork",
    description: "Rich and savory Japanese curry with tender pork pieces.",
    price: 13.95, dietary: [],
  },
  {
    id: "jc3", categoryId: "curries-ja",
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/b14a7b65-1772-47c2-b061-0249733641ad.jpeg",
    name: "Prawns",
    description: "Delicious Japanese curry simmered with succulent prawns.",
    price: 13.95, dietary: [],
  },
  {
    id: "jc4", categoryId: "curries-ja",
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/39879e27-606d-4469-a17c-2ca1e687f0fe.jpeg",
    name: "Vegetable",
    description: "A hearty mix of seasonal vegetables in a mildly spiced Japanese curry sauce.",
    price: 11.95, dietary: ["vegetarian", "vegan"],
  },


  /* ── TEPPANYAKI (NOODLES) ────────────────────────────── */
  {
    id: "tep1", categoryId: "teppanyaki",
    name: "Vegetable Noodles",
    description: "A mix of vegetables",
    price: 10.95, dietary: ["vegetarian", "vegan"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/855e4752-fd4b-4d9d-9cc7-ac10956b2477.jpeg"
  },
  {
    id: "tep2", categoryId: "teppanyaki",
    name: "Chicken Noodles",
    description: "Chicken and vegetable",
    price: 13.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/3b86d9ec-58c2-49ef-b456-9bb839e99ea5.jpeg"
  },
  {
    id: "tep3", categoryId: "teppanyaki",
    name: "Seafood Noodles",
    description: "Prawns, Calamari and vegetables",
    price: 13.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/5a446635-9021-4585-b9e9-4f1bc2d79fdd.jpeg"
  },
  {
    id: "tep4", categoryId: "teppanyaki",
    name: "Beef Noodles",
    description: "Beef and vegetables",
    price: 14.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/490fa833-985d-44c9-8977-20e76429a385.jpeg"
  },



  // More items can be added here for the Sushi menu.

  /* ── SUSHI ROLLS ────────────────────────────── */
  {
    id: "sr1", categoryId: "parent-sushi",
    name: "Dragon Roll",
    description: "Prawn Tempura, eel, avocado & Mayonnaise, sprinkled with crispy tempura crunches and finished with a drizzle of Unagi sauce.",
    price: 14.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/1821f0b5-7b93-47f3-adbb-bf7e81e9bf36.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (8 pcs)", price: 0 },
        ]
      },
    ],
  },
  {
    id: "sr2", categoryId: "parent-sushi",
    name: "Rainbow Roll",
    description: "Crab stick, avocado, Mayonnaise and thinly sliced salmon, seabass & tuna.",
    price: 15.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/cb0aee10-cd91-4da8-b203-0cbd1df87192.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (8 pcs)", price: 0 },
        ]
      },
    ],
  },
  {
    id: "sr3", categoryId: "parent-sushi",
    name: "Crazy Salmon Roll",
    description: "Salmon avocado filling inside topped with spicy salmon crunch",
    price: 16.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/07dacc72-98d6-4fca-8230-839829d35c0b.jpeg"
  },
  {
    id: "sr4", categoryId: "parent-sushi",
    name: "Spider Roll",
    description: "Tempura fried soft shell crab, cucumber and spring onion & flying fish roe.",
    price: 13.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/b8fc0c0c-61e0-4041-b54f-034eaadd77ed.png",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (6 pcs)", price: 0 },
        ]
      },
    ],
  },


  /* ── TEMAKI (HAND ROLLS) ────────────────────────────── */
  {
    id: "tm1", categoryId: "temaki",
    name: "California Temaki",
    description: "Crab Stick,Japanese Mayonnaise ,avocado ,cucumber flying fish roe & finished with a sprinkle of sesame seeds",
    price: 7.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/e591dcbf-7e52-44c9-93d0-72950dfbd008.jpeg"
  },
  {
    id: "tm2", categoryId: "temaki",
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/b313e75a-e175-4eaf-a51e-17876abb33ff.jpeg",
    name: "Spicy Tuna Temaki",
    description: "Diced Tuna,Japanese mayo,spring onion & Mixed chilli spices.",
    price: 8.95, dietary: []
  },
  {
    id: "tm3", categoryId: "temaki",
    name: "Salmon and Avocado Temaki",
    description: "Hand-rolled sushi cone filled with fresh salmon and creamy avocado.",
    price: 7.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/0aaa4aef-881f-412e-b81e-a75c395f853d.jpeg"
  },


  /* ── PLATTERS ────────────────────────────── */
  {
    id: "pl1", categoryId: "platters",
    name: "Platters",
    description: "A balanced selection of sushi, maki rolls, and fresh sashimi.",
    price: 39.90, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/7a019f4a-55ff-488a-ac8c-a88c8350d9b1.jpeg",
    variations: [
      {
        id: "v-size", name: "Platter size", options: [
          { id: "medium", label: "Medium - Sushi(6 pcs), Sashimi(6 pcs), Maki(8 pcs)", price: 0 },
          { id: "large", label: "Large - Sushi(8 pcs), Sashimi(15 pcs), Maki(24 pcs)", price: 25.00 },
        ]
      },
    ],
  },
  {
    id: "pl2", categoryId: "platters",
    name: "Maguro Sake",
    description: "Tuna and salmon sashimi.",
    price: 14.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/d746712b-5ca6-4663-9580-c5d4292bb4f3.jpeg",
    variations: [
      {
        id: "v-size", name: "Platter size", options: [
          { id: "regular", label: "Regular (10 pcs)", price: 0 },
        ]
      },
    ],
  },
  {
    id: "pl3", categoryId: "platters",
    name: "Sushi",
    description: "Fresh seafood served over seasoned sushi rice.",
    price: 4.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/15eb524e-a144-48ee-81f5-7bfdb4386f31.jpeg",
    variations: [
      {
        id: "v-type", name: "Choose Seafood", options: [
          { id: "ebi", label: "Prawn - Ebi (2 pcs)", price: 0 },
          { id: "ika", label: "Squid - Ika (2 pcs)", price: 0 },
        ]
      },
    ],
  },
  {
    id: "pl4", categoryId: "platters",
    name: "Saba - Mackerel",
    description: "Traditional mackerel nigiri with a rich, savory taste.",
    price: 5.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/1f1bce2d-51c9-4acf-858c-992b91dc5f67.jpeg",
    variations: [
      {
        id: "v-type", name: "Serving Style", options: [
          { id: "sushi", label: "Sushi (2 pcs)", price: 0 },
          { id: "shashimi", label: "Shashimi (5 pcs)", price: 2.00 },
        ]
      },
    ],
  },
  {
    id: "pl5", categoryId: "platters",
    name: "Sake - Salmon",
    description: "Premium salmon nigiri with a buttery texture.",
    price: 5.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/42c90138-ecf1-4125-b3a7-307e58425bab.jpeg",
    variations: [
      {
        id: "v-type", name: "Serving Style", options: [
          { id: "sushi", label: "Sushi (2 pcs)", price: 0 },
          { id: "shashimi", label: "Shashimi (5 pcs)", price: 3.00 },
        ]
      },
    ],
  },
  {
    id: "pl6", categoryId: "platters",
    name: "Maguro - Tuna",
    description: "Fresh tuna nigiri with a clean, rich flavor.",
    price: 6.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/9f32e414-bfbd-4d98-b65a-df20ce6fafc3.jpeg",
    variations: [
      {
        id: "v-type", name: "Serving Style", options: [
          { id: "sushi", label: "Sushi (2 pcs)", price: 0 },
          { id: "shashimi", label: "Shashimi (5 pcs)", price: 3.00 },
        ]
      },
    ],
  },
  {
    id: "pl7", categoryId: "platters",
    name: "Unagi - Eel",
    description: "Grilled eel nigiri glazed with a sweet savory sauce.",
    price: 6.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/db84d729-f419-4c81-80fc-c12ccd43fff9.jpeg",
    variations: [
      {
        id: "v-type", name: "Serving Style", options: [
          { id: "sushi", label: "Sushi (2 pcs)", price: 0 },
          { id: "shashimi", label: "Shashimi (5 pcs)", price: 2.00 },
        ]
      },
    ],
  },


  /* ── MAKI ────────────────────────────── */
  {
    id: "mk1", categoryId: "maki",
    name: "Kappa Maki - Cucumber RolL",
    description: "Cucumber rolled in sushi rice and nori seaweed, a refreshing and light option for sushi lovers.",
    price: 6.95, dietary: ["vegetarian", "vegan"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/39490282-fe09-4972-8e98-ccaf20600345.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (6 pcs)", price: 0 },
        ]
      },
    ],
  },
  {
    id: "mk2", categoryId: "maki",
    name: "Avocado Maki",
    description: "Avocado rolled in sushi rice and nori seaweed, a creamy and satisfying choice for sushi lovers.",
    price: 7.95, dietary: ["vegetarian"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/a5eb0418-a1a4-492f-9fd7-d650d2f564c7.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (6 pcs)", price: 0 },
        ]
      },
    ],
  },
  {
    id: "mk3", categoryId: "maki",
    name: "California Maki",
    description: "Japanese Mayo, Avocado, Crab Stick, Cucumber & flying fish roe, finished with a sprinkle of sesame seeds.",
    price: 9.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/b660f99a-5c43-4a88-878d-77c29e1e0bd5.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (8 pcs)", price: 0 },
        ]
      },
    ],
  },
  {
    id: "mk4", categoryId: "maki",
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/fba1f696-6c6a-4c2a-8ae5-1dbf9151eaaa.jpeg",
    name: "Tori Age Maki",
    description: "Chicken tempura filling, finished with a dizzle of UNAGI Sauce.",
    price: 10.95, dietary: ["halal"],
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (8 pcs)", price: 0 },
        ]
      },
    ],
  },
  {
    id: "mk5", categoryId: "maki",
    name: "Salmon Avocado Maki",
    description: "Salmon, Avocado, Japanese Mayo & flying fish roe.",
    price: 10.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/b5b41015-e909-48d3-b63d-8756e75905f7.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (8 pcs)", price: 0 },
        ]
      },
    ]
  },
  {
    id: "mk6", categoryId: "maki",
    name: "Ebi California Maki",
    description: "Tiger prawn, Cucumber, Avocado, Japanese mayo & flying fish roe finished with sesame seeds",
    price: 10.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/a210575f-82b1-48a9-aa5d-87bd7b56ace3.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (8 pcs)", price: 0 },
        ]
      },
    ]
  },
  {
    id: "mk7", categoryId: "maki",
    name: "Spicy Tuna Maki",
    description: "Diced Tuna, Japanese mayo, Spring onion & mixed chili spices finished with sesame seeds.",
    price: 12.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/cb6ab7d5-17e0-47e1-b43c-68eb3c958693.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (8 pcs)", price: 0 },
        ]
      },
    ]
  },
  {
    id: "mk8", categoryId: "maki",
    name: "Ebi Tempura Maki",
    description: "Deep fried tempura prawns, Cucumber, Japanese Mayo and finished with sesame seeds",
    price: 10.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/edb119ff-34f5-4546-ad7e-9baef6893448.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (8 pcs)", price: 0 },
        ]
      },
    ]
  },
  {
    id: "mk9", categoryId: "maki",
    name: "Dynamite Maki",
    description: "Deep fried maki with Prawn, eel, avocado, mayo & Unagi sauce.",
    price: 12.95, dietary: [],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/fc1a6845-973b-4bfe-87bb-4dc1ed51f704.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (8 pcs)", price: 0 },
        ]
      },
    ]
  },
  {
    id: "mk10", categoryId: "maki",
    name: "Spicy Beef Maki",
    description: "Spicy succulent beef, Japanese spiced mayo",
    price: 11.95, dietary: ["halal"],
    image: "https://sqcihdjgaoqbbjtlxlcj.supabase.co/storage/v1/object/public/menu-images/2026-06-18/88e5b45d-12eb-4a37-b701-d91bd6d033fa.jpeg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (8 pcs)", price: 0 },
        ]
      },
    ]
  },
  // {
  //   id: "mk11", categoryId: "maki",
  //   name: "Crazy Salmon Roll",
  //   description: "Salmon avocado filling inside topped with spicy salmon crunch",
  //   price: 12.95, dietary: [],
  //   image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRRpy-pTsHoFXfD7mZqk4ooRxr-R6XbYCAW-Q&s",
  //   variations: [
  //     {
  //       id: "v-size", name: "Portion size", options: [
  //         { id: "regular", label: "Regular (8 pcs)", price: 0 },
  //       ]
  //     },
  //   ]
  // }

];
