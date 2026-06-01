import { Category, MealPeriod, MenuItem } from "@/types";

export const categories: Category[] = [
  // Sri Lankan categories
  { id: "starters", name: "Starters - Sri Lankan", emoji: "🥟" },
  { id: "fried-rice", name: "Fried Rice - Sri Lankan", emoji: "🍚" },
  { id: "curries", name: "Curries - Sri Lankan", emoji: "🍛" },
  { id: "devils", name: "Devils - Sri Lankan", emoji: "🍗" },
  { id: "crab-specials", name: "Crab Specials - Sri Lankan", emoji: "🦀" },
  { id: "kottu", name: "Kottu - Sri Lankan", emoji: "🥘" },
  { id: "sides", name: "Sides - Sri Lankan", emoji: "🥗" },
  { id: "kids-menu", name: "Kids Menu - Sri Lankan", emoji: "🍟" },
  { id: "desserts", name: "Desserts - Sri Lankan", emoji: "🍰" },

  // Japanese categories
  { id: "starters-ja", name: "Starters - Japanese", emoji: "🥢" },
  { id: "tempura", name: "Tempura - Japanese", emoji: "🍤" },
  { id: "seafood", name: "Seafood - Japanese", emoji: "🦐" },
  { id: "meats", name: "Meats - Japanese", emoji: "🥩" },
  { id: "sides-ja", name: "Sides - Japanese", emoji: "🥗" },
  { id: "donburi", name: "Donburi - Japanese", emoji: "🍱" },
  { id: "curries-ja", name: "Curries - Japanese", emoji: "🍛" },
  { id: "teppanyaki", name: "Teppanyaki - Japanese", emoji: "🍜" },

  // Sushi categories
  { id: "sushi-rolls", name: "Sushi Rolls", emoji: "🍣" },
  { id: "temaki", name: "Temaki", emoji: "🌯" },
  { id: "platters", name: "Platters - Sushi", emoji: "🍱" },
  { id: "maki", name: "Maki", emoji: "🍥" },
];

// Two sensible defaults. Admin can rename, edit times, add more periods, or
// delete them entirely. Items reference these IDs in their mealPeriodIds list.
export const mealPeriods: MealPeriod[] = [
  {
    id: "mp-breakfast", name: "Breakfast",
    enabled: true, startTime: "07:00", endTime: "11:30",
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    sortOrder: 0,
  },
  {
    id: "mp-dinner", name: "Dinner",
    enabled: true, startTime: "17:00", endTime: "22:00",
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    sortOrder: 1,
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
    image: "https://www.kannammacooks.com/wp-content/uploads/srilankan-jaffna-fish-cutlets-recipe-1.jpg",
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
    image: "https://static.toiimg.com/thumb/53977854.cms?width=1200&height=900",
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
    image: "https://static.toiimg.com/thumb/61050397.cms?imgsize=246859&width=800&height=800",
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
    image: "https://st2.depositphotos.com/4404621/11594/i/950/depositphotos_115943080-stock-photo-sri-lankan-pol-roti.jpg",
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
    image: "https://www.chefajaychopra.com/assets/img/recipe/1-1665986104ChickenLollipopwebp.webp",
  },


  /* ── FRIED RICE ────────────────────────────── */
  {
    id: "fr1", categoryId: "fried-rice",
    name: "Lion's Special",
    description: "Chef’s special rice with chicken, pork, beef, prawns, squids & vegetable stir fried mixed with Chef’s special spicy mix.",
    image: "https://tb-static.uber.com/prod/image-proc/processed_images/24eafed516afa806f39415041db4ea5d/c9252e6c6cd289c588c3381bc77b1dfc.jpeg",
    price: 14.95, dietary: [],
  },
  {
    id: "fr2", categoryId: "fried-rice",
    name: "Seafood Fried Rice",
    description: "Prawns, Squid, vegetables & crab sticks",
    price: 13.95, dietary: [],
    image: "https://cicili.tv/wp-content/uploads/2025/08/Thai-Shrimp-Fried-Rice-Small-1-853x853.jpg",
  },
  {
    id: "fr3", categoryId: "fried-rice",
    name: "Egg Fried Rice",
    description: "Eggs & an array of vegetable",
    price: 8.95, dietary: ["vegan"],
    image: "https://cdn.sunbasket.com/43c6c3c7-146a-4404-b04a-52750e110e37.jpg",
  },
  {
    id: "fr4", categoryId: "fried-rice",
    name: "Chicken Fried Rice",
    description: "Chicken & an array of vegetables",
    price: 11.95, dietary: ["halal"],
    image: "https://i.ytimg.com/vi/lRzGgs6dK6g/hq720.jpg?sqp=-oaymwEhCK4FEIIDSFryq4qpAxMIARUAAAAAGAElAADIQj0AgKJD&rs=AOn4CLD7uE8D8z6dxMIxLHtNekIxFpbuoQ",
  },
  {
    id: "fr5", categoryId: "fried-rice",
    name: "Beef Fried Rice",
    description: "Beef & an array of vegetables",
    price: 12.95, dietary: [],
    image: "https://omnivorescookbook.com/wp-content/uploads/2024/04/240213_Beef-Fried-Rice_5.jpg",
  },


  /* ── CURRIES ────────────────────────────── */
  {
    id: "c1", categoryId: "curries",
    name: "Annasi Maaluwa",
    description: "Mixed Vegetables are cooked in coconut milk and infused with Sri Lankan authentic spices",
    price: 6.95, dietary: ["vegan"],
    image: "https://healthiersteps.com/wp-content/uploads/2018/01/pineapple-curry-1.jpg"
  },
  {
    id: "c2", categoryId: "curries",
    name: "Chicken Curry",
    description: "Chicken on the bone cooked with a mix of Sri Lankan spices.",
    price: 10.95, dietary: ["halal"],
    image: "https://ichef.bbci.co.uk/food/ic/food_16x9_1600/recipes/chicken_curry_61994_16x9.jpg"
  },
  {
    id: "c3", categoryId: "curries",
    name: "Dhal Curry",
    description: "Juicy pineapple chunks cooked in coconut milk and infused with sri lankan authentic spices.",
    price: 7.95, dietary: ["vegetarian"],
    image: "https://yarafoods.com/wp-content/uploads/2023/06/DSC_5214-scaled.jpg"
  },
  {
    id: "c4", categoryId: "curries",
    name: "Kaju Maaluwa",
    description: "Soaked cashews and peas cooked in rich coconut cream.",
    price: 8.95, dietary: ["vegan"],
    image: "https://savoryspin.com/wp-content/uploads/2021/04/PlantBased-Cashew-Curry.jpg"
  },
  {
    id: "c5", categoryId: "curries",
    name: "Polos Curry(Baby jackfruit curry)",
    description: "Unriped jackfruit seasoned with variety of Sri Lankan spices, cooked in creamy coconut milk for a flavor base.",
    price: 8.95, dietary: ["vegetarian"],
    image: "https://satyamskitchen.com/wp-content/uploads/2021/10/website-1-1-700x525.jpg"
  },
  {
    id: "c6", categoryId: "curries",
    name: "Salmon Curry",
    description: "Salmon fish cooked in rich coconut milk bursting with flavours of pandan leaves, curry leaves, cardamon and mix of spices.",
    price: 11.95, dietary: [],
    image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTjfslaMmhCkyolcDU0AFamF7kcphBtO-rlog&s"
  },
  {
    id: "c7", categoryId: "curries",
    name: "Lamb Curry",
    description: "Slow cooked boneless lamb in special roast spices",
    price: 11.95, dietary: ["halal"],
    image: "https://spicecravings.com/wp-content/uploads/2017/12/Lamb-Korma-New-2.jpg"
  },
  {
    id: "c8", categoryId: "curries",
    name: "Prawn Curry",
    description: "Shrimps are cooked in rich coconut milk with a mix of Sri Lankan spices",
    price: 10.95, dietary: [],
    image: "https://images.squarespace-cdn.com/content/v1/624fa63d5ba99559345806e6/7a61d184-c013-41b1-885e-89836d273e42/EG5_EP84_Sri-Lankan-Prawn-Curry.jpg"
  },
  {
    id: "c9", categoryId: "curries",
    name: "Black Pork Curry",
    description: "Pork cooked with a mix of Sri Lanka Spices, the colour is derived from a dark roasted curry powder",
    price: 10.95, dietary: [],
    image: "https://schoolofwok.co.uk/storage/app/uploads/public/699/492/3ad/6994923ad8cbf285117593.jpg"
  },


  /* ── DEVILS ────────────────────────────── */
  {
    id: "d1", categoryId: "devils",
    name: "Chicken Devil",
    description: "Spicy stir-fried chicken with onions, peppers, and a fiery devil sauce.",
    price: 12.95, dietary: ["halal"],
    image: "https://media-cdn.tripadvisor.com/media/photo-s/1c/df/de/f4/chicken-devil.jpg"
  },
  {
    id: "d2", categoryId: "devils",
    name: "Beef Devil",
    description: "Tender beef tossed with vegetables in a rich, spicy devil-style sauce.",
    price: 13.95, dietary: ["halal"],
    image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSLO_ELDA9jWGZrng_97Q870kK_npAJqGtAiw&s"
  },
  {
    id: "d3", categoryId: "devils",
    name: "Pork Devil",
    description: "Juicy pork stir-fried with peppers and onions in a hot and savory sauce.",
    image: "https://static2.kapruka.com/product-image/width=700,quality=93,f=auto/shops/specialGifts/additionalImages/large/1696330484089_temlr1071_m.jpg",
    price: 12.95, dietary: [],
  },
  {
    id: "d4", categoryId: "devils",
    name: "Prawn Devil",
    description: "Succulent prawns cooked with vegetables and a bold spicy devil seasoning.",
    price: 14.95, dietary: [],
    image: "https://media-cdn.tripadvisor.com/media/photo-s/16/d3/93/c6/prawn-devil.jpg"
  },
  {
    id: "d5", categoryId: "devils",
    name: "Mix Devil",
    description: "A flavorful combination of chicken, beef, pork, and prawns in spicy devil sauce.",
    price: 16.95, dietary: ["mix"],
    image: "https://kawumasboatkitchen.com/wp-content/uploads/2024/10/IMG_0659.jpg"
  },
  {
    id: "d6", categoryId: "devils",
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
    image: "https://vickypham.com/wp-content/uploads/2024/08/695e1-2023_02_27eosm56434.jpg"
  },
  {
    id: "cs2", categoryId: "crab-specials",
    name: "Garlic & Chilli Crab",
    description: "The iconic style of crab eaten in South Asia, our version includes a variety of zingy flavours to create the perfect taste.",
    price: 15.95, dietary: [],
    image: "https://assets.epicurious.com/photos/5908b4aa4321d935776c6abe/4:3/w_1776,h_1332,c_limit/singaporean-chili-crab-042317.jpg"
  },
  {
    id: "cs3", categoryId: "crab-specials",
    name: "Crab Curry",
    description: "A traditional sri lankan crab curry cooked in coconut milk and an array of spices",
    price: 16.95, dietary: [],
    image: "https://media.istockphoto.com/id/1049131400/photo/fried-crab-curry-powder.jpg?s=612x612&w=0&k=20&c=qF4bO-jz0SMTnqZNpBm9X7eq1-QXcAfrumIlYCsaflg="
  },


  /* ── KOTTU ────────────────────────────── */
  {
    id: "k1", categoryId: "kottu",
    name: "Seafood Kottu",
    description: "Chopped roti stir-fried with mixed seafood, vegetables, and aromatic spice",
    price: 14.95, dietary: [],
    image: "https://bmkltsly13vb.compat.objectstorage.ap-mumbai-1.oraclecloud.com/cdn.dailymirror.lk/media/images/image_1520592549-26916b3d6e.jpg"
  },
  {
    id: "k2", categoryId: "kottu",
    name: "Chicken Kottu",
    description: "Sri Lankan chopped roti tossed with chicken, vegetables, and savory spices.",
    price: 12.95, dietary: ["halal"],
    image: "https://thumbs.dreamstime.com/b/tantalizing-plate-traditional-sri-lankan-kottu-featuring-chopped-roti-stir-fried-medley-fresh-vegetables-338722528.jpg"
  },
  {
    id: "k3", categoryId: "kottu",
    name: "Mutton Kottu",
    description: "Flavorful chopped roti cooked with tender mutton, vegetables, and spices.",
    price: 13.95, dietary: [],
    image: "https://www.nestleprofessional.in/sites/default/files/2022-08/Kottu-756x471.jpg"
  },
  {
    id: "k4", categoryId: "kottu",
    name: "Veggie Kottu",
    description: "Chopped roti stir-fried with fresh vegetables and a blend of traditional spices.",
    price: 10.95, dietary: ["vegetarian"],
    image: "https://tuktuknegombo.com/wp-content/uploads/2024/11/Vegetable-Kottu-Negombo.webp"
  },


  /* ── SIDES ────────────────────────────── */
  {
    id: "si1", categoryId: "sides",
    name: "Coconut Sambol",
    description: "Grated fresh coconut blended with chilli flakes, onions, green chillies and black pepper",
    price: 6.95, dietary: ["vegan", "vegetarian"],
    image: "https://media-cdn2.greatbritishchefs.com/media/etbpfsnk/img86979.whqc_768x512q90.jpg"
  },
  {
    id: "si2", categoryId: "sides",
    name: "Paratha Roti",
    description: "Sri Lankan style flat bread.",
    price: 5.95, dietary: [],
    image: "https://shovelandcrunch.com/wp-content/uploads/2025/09/rougail-with-farata-closer.jpg",
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
    image: "https://himalayanbelfast.com/wp-content/uploads/2024/06/poppodoms.jpg",
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
    image: "https://mymorningmocha.com/wp-content/uploads/2024/03/masala-chips-recipe-500x500.jpg"
  },

  /* ── KIDS MENU ────────────────────────────── */
  {
    id: "km1", categoryId: "kids-menu",
    name: "Chicken Katsu with Curry Sauce",
    description: "Chicken breast coated in crispy panko bread crumbs Served with sticky white rice and Curry Sauce.",
    price: 8.95, dietary: ["halal"],
    image: "https://www.sbfoods-worldwide.com/recipes/t565ci0000000tz6-img/7_Chickencurry_recipe.jpg",
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
    image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTyHcjuzjIN5J5wzEwVn961mDdu7F6LIVPcIw&s",
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
    image: "https://i.ytimg.com/vi/lRzGgs6dK6g/hq720.jpg?sqp=-oaymwEhCK4FEIIDSFryq4qpAxMIARUAAAAAGAElAADIQj0AgKJD&rs=AOn4CLD7uE8D8z6dxMIxLHtNekIxFpbuoQ"
  },
  {
    id: "km4", categoryId: "kids-menu",
    name: "Chicken Nuggets and Chips",
    description: "Crispy chicken nuggets served with golden fries.",
    price: 8.95, dietary: ["halal"],
    image: "https://indiagatebridgwater.co.uk/wp-content/uploads/2023/05/nuggets.jpg"
  },


  /* ── DESSERTS ────────────────────────────── */
  {
    id: "ds1", categoryId: "desserts",
    name: "Carrot Cake",
    description: "Moist spiced carrot cake with a delicious vg finish.",
    price: 5.95, dietary: ["vegan"],
    image: "https://www.allrecipes.com/thmb/FdnjmAgpd-a2Df99LIY6wRsRrFQ=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/AR-17393-Best-Carrot-Cake-Ever-ddmfs-4x3-724b5c5584b04426852addcf85ac72af.jpg"
  },
  {
    id: "ds2", categoryId: "desserts",
    name: "Mochi",
    description: "Soft and chewy Japanese rice cake with a sweet filling.",
    price: 5.95, dietary: [],
    image: "https://kaitsuko.com/cdn/shop/articles/Mochi_japonais_couteaux_japonais_haut_de_gamme_5f8a4b79-91ec-43b4-a7b5-caa350f88c88.jpg?v=1738225336"
  },
  {
    id: "ds3", categoryId: "desserts",
    name: "Chocolate Fudge Cake",
    description: "Rich chocolate sponge layered with indulgent fudge icing.",
    price: 5.90, dietary: ["vegetarian"],
    image: "https://www.thebakingchocolatess.com/wp-content/uploads/2015/07/iOacjTbQ.jpg"
  },
  {
    id: "ds4", categoryId: "desserts",
    name: "Banana Tempura",
    description: "Lightly battered banana, fried until golden and crisp.",
    price: 6.95, dietary: ["vegetarian"],
    image: "https://s3.amazonaws.com/takami.co/CACHE/images/productimage/88cd831f29e44ef0aab15326bce44bbd/aoacojqd7hmf5ekrtdgdyk/8b3e9c00960ad381cf63924d25999da8.jpg"
  },
  {
    id: "ds5", categoryId: "desserts",
    name: "Ice Cream",
    description: "Smooth and creamy ice cream, served chilled.",
    price: 5.75, dietary: ["vegetarian"],
    image: "https://www.simplystacie.net/wp-content/uploads/2018/06/Mint-Chocolate-Chip-Ice-Cream-LOW-RES-33.jpg"
  },
  {
    id: "ds6", categoryId: "desserts",
    name: "Ice Cream Tempura",
    description: "Crispy fried coating with a cold, creamy ice cream center.",
    price: 7.95, dietary: ["vegetarian"],
    image: "https://snapcalorie-webflow-website.s3.us-east-2.amazonaws.com/media/food_pics_v2/medium/tempura_ice_cream.jpg"
  },
  {
    id: "ds7", categoryId: "desserts",
    name: "Wattalapam",
    description: "Traditional Sri Lankan coconut custard dessert infused with spices.",
    price: 6.95, dietary: ["vegetarian"],
    image: "https://recipe30.com/wp-content/uploads/2018/10/Watalappam.jpg"
  },



  // More items can be added here for the Japanese menu.

  /* ── STARTERS - JAPANESE ────────────────────────────── */
  {
    id: "js1", categoryId: "starters-ja",
    name: "Edamame",
    description: "Edamame beans seasoned with salt or chilli garlic",
    price: 7.95, dietary: ["vegan"],
    image: "https://assets.tmecosys.cn/image/upload/t_web_rdp_recipe_584x480_1_5x/img/recipe/ras/Assets/4B7928CA-9C8B-4ADF-97AB-F5D56D09FF86/Derivates/62D94DF4-04F3-4BA2-8751-F8AA13916CC2.jpg"
  },
  {
    id: "js2", categoryId: "starters-ja",
    name: "Seafood Korokke",
    description: "Freshly Made fish cake drizzled With delicious fruity tonkatsu sauce",
    price: 8.95, dietary: [],
    image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRBgDdb1x9yHzpcQ9CZSpPbSR5Rkzfskro0iA&s"
  },
  {
    id: "js3", categoryId: "starters-ja",
    name: "Ebi Karaage",
    description: "Prawns marinated in ginger, garlic & Japanese spices, lightly coated in corn flour and deep fried",
    price: 9.95, dietary: [],
    image: "https://ss2.sushihiro.my/wp-content/uploads/2023/08/2023_05_18_020259-1.jpg"
  },
  {
    id: "js4", categoryId: "starters-ja",
    name: "Steak Skewers",
    description: "Skewered steak served with spicy mayonnaise.",
    price: 10.95, dietary: [],
    image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSPFvSrs4YAWNxx-fGA8Ogb6S8lJtkrAFzkGg&s"
  },
  {
    id: "js5", categoryId: "starters-ja",
    name: "Miso Shiru",
    description: "Soybeans, fish stock, seaweed, Tofu & spring onion soup",
    price: 5.95, dietary: [],
    image: "https://happydonabelife.com/wp-content/uploads/Misoshiru.jpg"
  },
  {
    id: "js6", categoryId: "starters-ja",
    name: "Yakitori",
    description: "Pan-fried, skewered chicken & leeks, slow cooked with teriyaki sauce",
    price: 9.95, dietary: ["halal"],
    image: "https://assets.tmecosys.cn/image/upload/t_web_rdp_recipe_584x480/img/recipe/ras/Assets/8B3356E6-970E-4E09-9A61-4F27F249F479/Derivates/d6371208-a364-42cd-bb20-2eeae1184548.jpg"
  },
  {
    id: "js7", categoryId: "starters-ja",
    name: "Tori Karaage",
    description: "Chicken marinated in ginger, garlic & japanese spices lightly coated in tempura flour deep fried",
    price: 9.95, dietary: ["halal"],
    image: "https://www.sushijunction.com/cdn/shop/products/Chicken-Tori-Karaage-SD.jpg?v=1476274947"
  },
  {
    id: "js8", categoryId: "starters-ja",
    name: "Age Dashi Tofu",
    description: "Golden fried tofu Served with tempura sauce, spring onion & seaweed",
    price: 7.95, dietary: [],
    image: "https://masimasa.com/cdn/shop/articles/masi-masa-agedashi-tofu-square-01_1080x.jpg?v=1700084107"
  },
  {
    id: "js9", categoryId: "starters-ja",
    name: "Mini Vegetable Spring Rolls",
    description: "A variety of vegetables rolled in a fine pastry and fried.",
    price: 7.95, dietary: ["vegan"],
    image: "https://saltedmint.com/wp-content/uploads/2024/01/Vegetable-Spring-Rolls-4-500x375.jpg"
  },
  {
    id: "js10", categoryId: "starters-ja",
    name: "Chicken Wings",
    description: "Seasoned crispy Chicken wings fried in corn flour and served with spicy mayo or ketchup",
    price: 9.95, dietary: ["halal"],
    image: "https://mccormick.widen.net/content/sfyhldvs4t/webp/Franks_Shake_On_Wings_2024_800x800.webp"
  },
  {
    id: "js11", categoryId: "starters-ja",
    name: "Gyoza",
    description: "Chicken stuffed dumplings steamed or fried.",
    price: 8.95, dietary: ["halal"],
    image: "https://imagedelivery.net/9lr8zq_Jvl7h6OFWqEi9IA/30a7d526-9037-4d77-fbfc-55a9e7dea700/public",
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
    image: "https://grillinwithdad.com/wp-content/uploads/2024/06/spicy-beef-featured.jpg"
  },


  /* ── TEMPURA ────────────────────────────── */
  {
    id: "t1", categoryId: "tempura",
    name: "Ebi Tempura - Prawns",
    description: "Lightly battered prawns fried until golden and crispy.",
    price: 11.95, dietary: [],
    image: "https://www.houseofdimsum.co.za/cdn/shop/files/japanese-prawn-tempura-15pc-434909.jpg?v=1711401860"
  },
  {
    id: "t2", categoryId: "tempura",
    name: "Yasai - Assorted Vegetables",
    description: "Assorted fresh vegetables in a light, crispy tempura batter.",
    price: 9.95, dietary: ["vegan"],
    image: "https://www.justonecookbook.com/wp-content/uploads/2020/04/Stir-Fry-Vegetables-Yasai-Itame-7817-I-500x375.jpg"
  },
  {
    id: "t3", categoryId: "tempura",
    name: "Ika Tempura - Calamari",
    description: "Tender calamari coated in tempura batter and fried to perfection.",
    price: 10.95, dietary: [],
    image: "https://pacificbay.com.ph/cdn/shop/articles/tempura-calamari-crispy-squid-rings-3367201.jpg?crop=center&height=1200&v=1769"
  },
  {
    id: "t4", categoryId: "tempura",
    name: "Kani Tempura - Soft Shell Crab",
    description: "Crispy soft shell crab served in a delicate tempura coating.",
    price: 10.95, dietary: [],
    image: "https://handycrab.com/wp-content/uploads/2025/09/2302020-Tempura_Soft_Shell_Jumbo_18681.webp"
  },
  {
    id: "t5", categoryId: "tempura",
    name: "Mixed Seafood Tempura",
    description: "A selection of seafood lightly battered and fried until crisp.",
    price: 13.95, dietary: ["mix"],
    image: "https://www.thespruceeats.com/thmb/5xkGMB8ZXz3KGF_y4Uxf7ZfQAvQ=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/ebi-fry-fried-shrimp-2031450-hero-01-46c436a89c164a9ab5980f888097fcd2.jpg"
  },


  /* ── SEAFOOD - JAPANESE ────────────────────────────── */
  {
    id: "sf1", categoryId: "seafood",
    name: "Squid - Ika",
    description: "Fresh squid prepared with authentic Japanese flavors.",
    price: 16.95, dietary: [],
    image: "https://www.kikkoman.com/en/cookbook/assets/img/GlossarySquid.jpg"
  },
  {
    id: "sf2", categoryId: "seafood",
    name: "Salmon - Sake",
    description: "cook with teriyaki sauce / garlic,butter,soy sauce",
    price: 19.95, dietary: [],
    image: "https://125282008.cdn6.editmysite.com/uploads/1/2/5/2/125282008/FYBZ76UYLRSCD5UMTDTFUA6B.jpeg"
  },
  {
    id: "sf3", categoryId: "seafood",
    name: "Sea Bass - Suzuki",
    description: "Mild and flaky sea bass with a clean, delicate taste.",
    price: 19.95, dietary: [],
    image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRz_nZ-ebYm9xOQiheI9lnvQK9-xavTy-EMHg&s"
  },
  {
    id: "sf4", categoryId: "seafood",
    name: "Prawns - Ebi",
    description: "Succulent prawns prepared in traditional Japanese style.",
    price: 18.95, dietary: [],
    image: "https://www.thespruceeats.com/thmb/5xkGMB8ZXz3KGF_y4Uxf7ZfQAvQ=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/ebi-fry-fried-shrimp-2031450-hero-01-46c436a89c164a9ab5980f888097fcd2.jpg"
  },


  /* ── MEATS - JAPANESE ────────────────────────────── */
  {
    id: "m1", categoryId: "meats",
    name: "T Bone Steak",
    description: "Marinde soy sauce, lemon juice, pepper, garlic and red wine",
    price: 25.95, dietary: [],
    image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcShXivZt65VQUhPA_JcJvgGhKtWxKgW3Wtv_g&s"
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
    image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRxn5ZZST-jVGZqaQg8qTLGk7M8LhfnHFYVHw&s"
  },
  {
    id: "m4", categoryId: "meats",
    name: "Rib Eye Steak",
    description: "Cooked with garlic,butter,soy sauce",
    price: 24.95, dietary: [],
    image: "https://andianne.com/wp-content/uploads/2024/12/pan-fried-ribeye-steak-07.jpg"
  },
  {
    id: "m5", categoryId: "meats",
    name: "Rump of Lamb",
    description: "Cooked with garlic, butter, onion, mushrooms & saysauce",
    price: 21.95, dietary: ["halal"],
    image: "https://api.photon.aremedia.net.au/wp-content/uploads/sites/10/Gt/2022/10/25/20404/WEB_Harissa-roasted-lamb-rump--pomegranate--and-eggplant-02.jpg?fit=1200%2C1000"
  },
  {
    id: "m6", categoryId: "meats",
    name: "Breast of Duck",
    description: "Cooked with teriyaki sauce",
    price: 22.95, dietary: [],
    image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRsXjUws9_vxP2zWsEO6QQqB9c9KjyZ_U7zzw&s"
  },


  /* ── SIDES - JAPANESE ────────────────────────────── */
  {
    id: "sja1", categoryId: "sides-ja",
    name: "Garlic Mushrooms",
    description: "Mushrooms cooked in garlic butter with soya sauce",
    price: 6.95, dietary: ["vegetarian"],
    image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRkzpV0Fe6qDfWjVxsNei3Sf6WuEIiZN5dmvQ&s"
  },
  {
    id: "sja2", categoryId: "sides-ja",
    name: "Plain Noodles",
    description: "Plain, Boiled noodles",
    price: 5.95, dietary: ["vegetarian"],
    image: "https://www.ohmyveg.co.uk/wp-content/uploads/2024/06/Beansprout-Noodles-2-e1722869825410.jpg"
  },
  {
    id: "sja3", categoryId: "sides-ja",
    name: "Asparagus",
    description: "Asparagus cooked in garlic butter and soy sauce",
    price: 8.95, dietary: ["vegetarian"],
    image: "https://cdn.shopify.com/s/files/1/0512/5449/3376/files/Sweet___Spicy_Asparagus_480x480.jpg?v=1607712197"
  },
  {
    id: "sja4", categoryId: "sides-ja",
    name: "Japanese Sticky Rice",
    description: "Plain, Boiled Japanese sticky rice",
    price: 5.95, dietary: ["vegan"],
    image: "https://veganrecipebowl.com/wp-content/uploads/2020/12/cooking_japanese_rice_1200x1200-500x500.jpg"
  },
  {
    id: "sja5", categoryId: "sides-ja",
    name: "Long Grain Rice",
    description: "Plain, Boiled Long grain rice",
    price: 5.95, dietary: ["vegan"],
    image: "https://www.simplyrecipes.com/thmb/XbSIRREjxXEg3Oe34a1lNY1Qsdw=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/__opt__aboutcom__coeus__resources__content_migration__simply_recipes__uploads__2017__05__2017-05-22-HT-Rice-17-be6d7b577bbf44b4908f561837bb78f6.jpg"
  },
  {
    id: "sja6", categoryId: "sides-ja",
    name: "Mushroom Panko-Age",
    description: "Breaded, deep fried mushrooms",
    price: 6.95, dietary: ["vegetarian"],
    image: "https://www.the-girl-who-ate-everything.com/wp-content/uploads/2012/11/crispy-baked-mushrooms-07.jpg"
  },
  {
    id: "sja7", categoryId: "sides-ja",
    name: "Spicy Cauliflower",
    description: "BMarinated in light spice",
    price: 6.95, dietary: ["vegan"],
    image: "https://www.thespruceeats.com/thmb/hAs56LBT-rOWZnzzbefj2cTX-5Q=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/spicy-roasted-cauliflower-2217341-hero-01-fc1ec1770f4d4c6c96153510140d1a94.jpg"
  },


  /* ── DONBURI - JAPANESE ────────────────────────────── */
  {
    id: "db1", categoryId: "donburi",
    name: "Pork Katsu-Don",
    description: "Crispy pork cutlet served over rice with a savory egg topping.",
    price: 13.95, dietary: [],
    image: "https://static.wixstatic.com/media/d60c54_75ca4307ffbc4d95a7f9d153507ea83f~mv2.jpeg/v1/fill/w_528,h_352,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/d60c54_75ca4307ffbc4d95a7f9d153507ea83f~mv2.jpeg"
  },
  {
    id: "db2", categoryId: "donburi",
    name: "Chicken Katsu-Don",
    description: "Breaded chicken cutlet served over rice with egg and savory sauce.",
    price: 14.95, dietary: ["halal"],
    image: "https://foreignfork.com/wp-content/uploads/2023/04/Katsudon-FEATURE.jpg"
  },


  /* ── JAPANESE CURRY ────────────────────────────── */
  {
    id: "jc1", categoryId: "curries-ja",
    name: "Chicken",
    description: "A traditional Japanese chicken curry served with steamed rice.",
    price: 14.95, dietary: ["halal"],
  },
  {
    id: "jc2", categoryId: "curries-ja",
    name: "Pork",
    description: "Rich and savory Japanese curry with tender pork pieces.",
    price: 13.95, dietary: [],
  },
  {
    id: "jc3", categoryId: "curries-ja",
    name: "Prawns",
    description: "Delicious Japanese curry simmered with succulent prawns.",
    price: 13.95, dietary: [],
  },
  {
    id: "jc4", categoryId: "curries-ja",
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
    image: "https://vegecravings.com/wp-content/uploads/2017/03/veg-hakka-noodles-recipe-with-step-by-step-instructions.jpg"
  },
  {
    id: "tep2", categoryId: "teppanyaki",
    name: "Chicken Noodles",
    description: "Chicken and vegetable",
    price: 13.95, dietary: ["halal"],
    image: "https://static.toiimg.com/thumb/75356205.cms?width=1200&height=900"
  },
  {
    id: "tep3", categoryId: "teppanyaki",
    name: "Seafood Noodles",
    description: "Prawns, Calamari and vegetables",
    price: 13.95, dietary: [],
    image: "https://delightfulplate.com/wp-content/uploads/2023/09/Seafood-Glass-Noodle-Stir-fry-Mien-Xao-Hai-San.jpg"
  },
  {
    id: "tep4", categoryId: "teppanyaki",
    name: "Beef Noodles",
    description: "Beef and vegetables",
    price: 14.95, dietary: [],
    image: "https://www.cherryonmysundae.com/wp-content/uploads/2014/07/chinese-beef-stew-final-feature.jpg"
  },



  // More items can be added here for the Sushi menu.

  /* ── SUSHI ROLLS ────────────────────────────── */
  {
    id: "sr1", categoryId: "sushi-rolls",
    name: "Dragon Roll",
    description: "Prawn Tempura, eel, avocado & Mayonnaise, sprinkled with crispy tempura crunches and finished with a drizzle of Unagi sauce.",
    price: 14.95, dietary: [],
    image: "https://cdn.zyrosite.com/cdn-cgi/image/format=auto,w=768,h=576,fit=crop/cdn-ecommerce/store_01JD1QYNVX2QFMYWSQNDQTCQ1B%2Fassets%2F1736024286907-Golddragonroll.jpg",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (8 pcs)", price: 0 },
        ]
      },
    ],
  },
  {
    id: "sr2", categoryId: "sushi-rolls",
    name: "Rainbow Roll",
    description: "Crab stick, avocado, Mayonnaise and thinly sliced salmon, seabass & tuna.",
    price: 15.95, dietary: [],
    image: "https://i0.wp.com/s.lightorangebean.com/media/20241104165159/Rainbow-Sushi-Rolls_-done.jpg?resize=480%2C270&quality=89&ssl=1",
    variations: [
      {
        id: "v-size", name: "Portion size", options: [
          { id: "regular", label: "Regular (8 pcs)", price: 0 },
        ]
      },
    ],
  },
  {
    id: "sr3", categoryId: "sushi-rolls",
    name: "Crazy Salmon Roll",
    description: "Salmon avocado filling inside topped with spicy salmon crunch",
    price: 16.95, dietary: [],
    image: "https://assets.dots.live/misteram-public/019dd484-6e92-7323-9c66-0bf8143f155d-826x0.png"
  },
  {
    id: "sr4", categoryId: "sushi-rolls",
    name: "Spider Roll",
    description: "Tempura fried soft shell crab, cucumber and spring onion & flying fish roe.",
    price: 13.95, dietary: [],
    image: "https://popmenucloud.com/cdn-cgi/image/width%3D1200%2Cheight%3D1200%2Cfit%3Dscale-down%2Cformat%3Dauto%2Cquality%3D60/ljzxghre/ba6a2dbc-8043-4cd2-85c1-69a828f937cb.jpg",
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
    image: "https://img.magnific.com/premium-photo/japanese-food-salmon-temaki-california-temaki-white-plate-isolated-closeup_491130-3503.jpg"
  },
  {
    id: "tm2", categoryId: "temaki",
    name: "Spicy Tuna Temaki",
    description: "Diced Tuna,Japanese mayo,spring onion & Mixed chilli spices.",
    price: 8.95, dietary: []
  },
  {
    id: "tm3", categoryId: "temaki",
    name: "Salmon and Avocado Temaki",
    description: "Hand-rolled sushi cone filled with fresh salmon and creamy avocado.",
    price: 7.95, dietary: [],
    image: "https://i0.wp.com/chiliandtonic.com/wp-content/uploads/2021/08/hand-rolls-temaki-01.jpg?resize=720%2C514&ssl=1"
  },


  /* ── PLATTERS ────────────────────────────── */
  {
    id: "pl1", categoryId: "platters",
    name: "Platters",
    description: "A balanced selection of sushi, maki rolls, and fresh sashimi.",
    price: 39.90, dietary: [],
    image: "https://www.yakinori.co.uk/wp-content/uploads/2024/11/Untitled-design-12.png",
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
    image: "https://images.squarespace-cdn.com/content/5c658114ab1a625acb417fc9/1582744194668-7LFG7DI3S1AUNQ5Y0L6O/IMG_5920.jpg?format=1500w&content-type=image%2Fjpeg",
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
    image: "https://popmenucloud.com/cdn-cgi/image/width=1920,height=1920,format=auto,fit=scale-down/qensowjl/b55dd500-432e-4c23-a174-6fe69b9f3117.jpg",
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
    image: "https://thehappyfoodie.co.uk/wp-content/uploads/2021/08/sushi_at_home_4_73_img_s900x0_c1775x1037_l456x1361.jpg",
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
    image: "https://sushistaycation.com/wp-content/uploads/2024/03/salmon_nigiri_sake_thumbnail.jpg",
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
    image: "https://sushi29.ca/wp-content/uploads/2021/07/26.magurotuna-scaled.jpg",
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
    image: "https://takestwoeggs.com/wp-content/uploads/2023/08/Unagi-Sushi-eel-sushi-takestwoeggs-sq.jpg",
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
    image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSu1ZJQ0bhCnQ42jkpg_KBvWahcJwMJce70wg&s",
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
    image: "https://www.craftycookbook.com/wp-content/uploads/2024/05/avocado-maki-sushi-roll-1200.jpg",
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
    image: "https://kimonoken.com/cdn/shop/products/prod_calimaki.jpg?v=1754439365",
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
    image: "https://imagedelivery.net/9lr8zq_Jvl7h6OFWqEi9IA/e5335895-5c0f-4d67-05d0-295084199500/public",
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
    image: "https://www.sushiroom.ro/wp-content/uploads/2019/09/California-Roll.jpeg",
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
    image: "https://www.rachelphipps.com/wp-content/uploads/2020/12/Spicy-Tinned-Tuna-Rolls.jpg",
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
    image: "https://snapcalorie-webflow-website.s3.us-east-2.amazonaws.com/media/food_pics_v2/medium/shrimp_tempura_sushi.jpg",
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
    image: "https://honolulusushi.com/storage/129/responsive-images/dynamitewebp___media_library_original_1000_667.webp",
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
    image: "https://images.squarespace-cdn.com/content/v1/59382c906b8f5b82cbd8a41a/1512681262423-Q0BXHF6GEN2BF4AHX2IR/L1060224+%281%29+2.jpg",
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
