import { RestaurantInfo, WeekSchedule } from "@/types";

export const restaurantInfo: RestaurantInfo = {
  name: "Spice Garden",
  tagline: "Authentic Indian Cuisine",
  coverImage: "https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=1400&q=80",
  logoImage: "https://images.unsplash.com/photo-1567521464027-f127ff144326?w=200&q=80",
  hygieneRating: 5,
  deliveryTime: 30,
  collectionTime: 15,
  minOrder: 12.00,
  deliveryFee: 1.99,
  serviceFee: 5,
  addressLine1: "42 Curry Lane",
  addressLine2: "",
  city: "London",
  postcode: "E1 6RF",
  country: "United Kingdom",
  phone: "020 7123 4567",
  lat: 51.5150,   // Whitechapel, East London
  lng: -0.0630,
};

export const defaultSchedule: WeekSchedule = {
  Monday:    { open: "11:00", close: "22:30", closed: false },
  Tuesday:   { open: "11:00", close: "22:30", closed: false },
  Wednesday: { open: "11:00", close: "22:30", closed: false },
  Thursday:  { open: "11:00", close: "22:30", closed: false },
  Friday:    { open: "11:00", close: "23:00", closed: false },
  Saturday:  { open: "11:00", close: "23:00", closed: false },
  Sunday:    { open: "12:00", close: "22:00", closed: false },
};
