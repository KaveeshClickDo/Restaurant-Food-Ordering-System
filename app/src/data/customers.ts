import { Customer } from "@/types";

function iso(daysAgo: number, hour = 19): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString();
}

export const mockCustomers: Customer[] = [
  {
    id: "cust-001",
    name: "Emily Clarke",
    email: "emily.clarke@email.com",
    password: "password",
    phone: "07700 900123",
    createdAt: iso(120),
    tags: ["VIP", "Regular"],
    orders: [
      {
        id: "ord-001-a",
        customerId: "cust-001",
        date: iso(2, 19),
        status: "delivered",
        fulfillment: "delivery",
        total: 42.45,
        address: "14 Maple St, London, E1 6AN",
        items: [
          { name: "Chicken Tikka Masala", qty: 2, price: 13.50 },
          { name: "Garlic Butter Naan", qty: 2, price: 3.25 },
          { name: "Mango Lassi", qty: 2, price: 3.75 },
        ],
      },
      {
        id: "ord-001-b",
        customerId: "cust-001",
        date: iso(14, 20),
        status: "delivered",
        fulfillment: "delivery",
        total: 35.90,
        address: "14 Maple St, London, E1 6AN",
        items: [
          { name: "Butter Chicken", qty: 1, price: 13.50 },
          { name: "Lamb Rogan Josh", qty: 1, price: 14.95 },
          { name: "Pilau Rice", qty: 2, price: 3.50 },
        ],
      },
      {
        id: "ord-001-c",
        customerId: "cust-001",
        date: iso(30, 18),
        status: "delivered",
        fulfillment: "collection",
        total: 28.75,
        items: [
          { name: "Paneer Tikka Masala", qty: 1, price: 11.95 },
          { name: "Onion Bhaji", qty: 2, price: 5.50 },
          { name: "Basmati Rice", qty: 1, price: 3.00 },
        ],
      },
    ],
  },
  {
    id: "cust-002",
    name: "James Patel",
    email: "james.patel@gmail.com",
    password: "password",
    phone: "07911 123456",
    createdAt: iso(60),
    tags: ["Regular"],
    orders: [
      {
        id: "ord-002-a",
        customerId: "cust-002",
        date: iso(1, 12),
        status: "preparing",
        fulfillment: "delivery",
        total: 31.20,
        address: "8 Oak Avenue, London, E2 8QA",
        items: [
          { name: "Seekh Kebab", qty: 1, price: 7.95 },
          { name: "Chicken Biryani", qty: 1, price: 14.50 },
          { name: "Egg Fried Rice", qty: 1, price: 4.00 },
        ],
      },
      {
        id: "ord-002-b",
        customerId: "cust-002",
        date: iso(20, 21),
        status: "delivered",
        fulfillment: "delivery",
        total: 22.45,
        address: "8 Oak Avenue, London, E2 8QA",
        items: [
          { name: "Butter Chicken", qty: 1, price: 13.50 },
          { name: "Peshwari Naan", qty: 2, price: 3.50 },
        ],
      },
    ],
  },
  {
    id: "cust-003",
    name: "Sophia Williams",
    email: "sophia.w@outlook.com",
    password: "password",
    phone: "07800 654321",
    createdAt: iso(10),
    tags: ["New"],
    orders: [
      {
        id: "ord-003-a",
        customerId: "cust-003",
        date: iso(0, 18),
        status: "confirmed",
        fulfillment: "collection",
        total: 19.50,
        items: [
          { name: "Samosa (2 pcs)", qty: 2, price: 4.50 },
          { name: "Chana Masala", qty: 1, price: 10.50 },
        ],
      },
    ],
  },
  {
    id: "cust-004",
    name: "Marcus Johnson",
    email: "m.johnson@work.co.uk",
    phone: "07777 234567",
    createdAt: iso(250),
    tags: ["VIP", "Regular"],
    orders: [
      {
        id: "ord-004-a",
        customerId: "cust-004",
        date: iso(3, 13),
        status: "delivered",
        fulfillment: "delivery",
        total: 58.90,
        address: "22 Rose Lane, London, SE1 4DW",
        items: [
          { name: "King Prawn Masala", qty: 2, price: 16.95 },
          { name: "Lamb Keema Curry", qty: 1, price: 13.95 },
          { name: "Garlic Butter Naan", qty: 3, price: 3.25 },
        ],
      },
      {
        id: "ord-004-b",
        customerId: "cust-004",
        date: iso(10, 20),
        status: "delivered",
        fulfillment: "delivery",
        total: 44.20,
        address: "22 Rose Lane, London, SE1 4DW",
        items: [
          { name: "Chicken Tikka Masala", qty: 2, price: 13.50 },
          { name: "Saag Paneer", qty: 1, price: 11.50 },
          { name: "Basmati Rice", qty: 2, price: 3.00 },
        ],
      },
      {
        id: "ord-004-c",
        customerId: "cust-004",
        date: iso(45, 19),
        status: "cancelled",
        fulfillment: "delivery",
        total: 28.00,
        address: "22 Rose Lane, London, SE1 4DW",
        items: [
          { name: "Fish Curry", qty: 1, price: 14.95 },
          { name: "Pilau Rice", qty: 2, price: 3.50 },
        ],
        note: "Customer cancelled — requested refund",
      },
    ],
  },
  {
    id: "cust-005",
    name: "Aisha Rahman",
    email: "aisha.r@hotmail.com",
    phone: "07900 876543",
    createdAt: iso(35),
    tags: ["Regular"],
    orders: [
      {
        id: "ord-005-a",
        customerId: "cust-005",
        date: iso(5, 21),
        status: "delivered",
        fulfillment: "delivery",
        total: 36.80,
        address: "6 Park Rd, London, N1 2AB",
        items: [
          { name: "Dal Makhani", qty: 1, price: 10.50 },
          { name: "Aloo Gobi", qty: 1, price: 9.95 },
          { name: "Peshwari Naan", qty: 2, price: 3.50 },
          { name: "Gulab Jamun", qty: 2, price: 4.50 },
        ],
      },
    ],
  },
  {
    id: "cust-006",
    name: "Tom Harrington",
    email: "tom.h89@gmail.com",
    phone: "07555 321987",
    createdAt: iso(180),
    tags: ["Inactive"],
    orders: [
      {
        id: "ord-006-a",
        customerId: "cust-006",
        date: iso(90, 18),
        status: "delivered",
        fulfillment: "collection",
        total: 25.45,
        items: [
          { name: "Vegetable Spring Rolls (3 pcs)", qty: 1, price: 5.25 },
          { name: "Paneer Tikka Masala", qty: 1, price: 11.95 },
          { name: "Jeera Aloo", qty: 1, price: 8.25 },
        ],
      },
    ],
  },
];
