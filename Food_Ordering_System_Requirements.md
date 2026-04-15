# Single-Restaurant Food Ordering System
## Project Overview
A full-stack web application designed for a single restaurant, featuring a pixel-perfect frontend clone of the Just Eat menu page and a comprehensive admin dashboard for operational management.

## Tech Stack
* **Frontend:** Next.js, React, Tailwind CSS
* **Backend (Proposed):** Node.js, Express.js
* **Database (Proposed):** MongoDB or PostgreSQL
* **Icons:** lucide-react

## Core Features

### 1. Customer Frontend (Just Eat Clone)
* **Header:** Restaurant info, delivery/collection toggles, timings, minimum order value.
* **Navigation:** Sticky category sidebar with ScrollSpy functionality.
* **Menu Items:** Grouped by category, exact layout matching Just Eat with "+" add buttons.
* **Cart:** Sticky right sidebar with dynamic calculations (subtotal, delivery fee, service fee).
* **Customization:** Modals for item variations and add-ons (spice level, extra toppings).
* **Search & Filters:** Real-time search and dietary toggles (Vegan, Halal, etc.).
* **Mobile Responsiveness:** Horizontal scrolling categories and floating bottom cart button.

### 2. Operational Logic & Cart Rules
* **Minimum Order Validation:** Checkout button disables if the subtotal is below the threshold.
* **Store Hours:** Automatic "Closed for Orders" state based on predefined schedules.
* **Dynamic Fees:** Real-time calculation of delivery and service fees based on admin settings.

### 3. Admin Dashboard
* **Menu Management:** Full CRUD operations for menu categories and items. Features dietary tags, option variations, add-ons, category reordering, and item images (via URL or local file upload).
* **Customers & Orders:** View registered customers, complete order history, and lifetime value. Includes a customer detail drawer to track and update live order statuses (Pending → Confirmed → Preparing → Ready → Delivered).
* **Restaurant Operations:** Manage opening hours, delivery times, collection times, and a manual open/close override.
* **Financial Settings:** Set delivery fees, service fees, and minimum order limits.
* **Integrations:** Secure inputs for Stripe/PayPal API keys and SMTP credentials for email notifications.

---

## Master Claude Prompt for Frontend Generation
*Copy and paste the following prompt to Claude.ai to generate the React/Next.js frontend:*

> Act as a Senior Full-Stack Developer and UI/UX Expert. I am conducting a research project and need to build a "Single-Restaurant Food Ordering Web Application" using **Next.js, React, and Tailwind CSS**.
> 
> **CRITICAL REQUIREMENT:** The frontend User Interface must be a **pixel-perfect, exact visual clone** of the Just Eat restaurant menu page. Pay strict attention to their typography, spacing, border radiuses, and specific color palette. 
> 
> Please generate the comprehensive code for the following features, ensuring **ALL interactive functionalities** of the Just Eat menu page are included:
> 
> **1. Exact Just Eat Frontend Clone & Core Functions:**
> * **Header Section:** Restaurant cover image, logo, and the dynamic info box (Delivery/Collection toggles, Estimated Times, Min Order, and Food Hygiene rating).
> * **Search & Filters:** Include a working "Search menu" input and dietary filter toggles (Vegetarian, Vegan, etc.) just like Just Eat.
> * **3-Column Desktop Layout & Interactions:**
>   * *Left Column (Sticky):* Category navigation list. **Must include ScrollSpy functionality** (highlight the active category as the user scrolls down the middle section). Clicking scrolls to the section.
>   * *Middle Column:* Menu items grouped by category. Exact layout (Title, description, price, dietary badges, and the "+" button).
>   * *Right Column (Sticky):* Shopping Cart. Exact UI with items, +/- controls, subtotal, delivery fee, service fee, grand total, and a "Clear Basket" option.
> * **Item Customization Modal:** When clicking a menu item, open a modal for item variations/add-ons (e.g., "Choose your spice level", "Add extra toppings", "Special instructions") before it gets added to the cart.
> * **Mobile View:** Perfect mobile web replication (horizontal scrolling categories, bottom floating "View Cart" button).
> 
> **2. Cart Logic & Operational Rules (Real-time State):**
> * **Min Order:** Disable the checkout button if the subtotal is below the minimum order value, showing the exact "Add £X more..." text.
> * **Shop Closed Logic:** If the shop is closed, show a "Closed for Orders" banner and disable all "+" add to cart buttons.
> * **Checkout Flow:** Clicking Checkout opens a modal/route with a user details form and mockup payment buttons for "Pay with Credit Card (Stripe)" and "Pay with PayPal".
> 
> **3. Admin Dashboard (Separate Route/UI):**
> Create a clean, separate Admin layout to manage the dynamic variables powering the frontend:
> * **Payment & Email Settings:** Inputs for Stripe Keys, PayPal Client ID, and SMTP Settings.
> * **Restaurant Operations:** Inputs for Minimum Order Value, Delivery Fee, Service Fee, Delivery Time, and Collection Time.
> * **Store Schedule:** Monday-Sunday opening/closing times and a master "Manual Open/Close" toggle to instantly stop orders.
> 
> **4. Technical Implementation:**
> * Use React `useState`, `useEffect`, and `useRef` (for scroll tracking) to wire all UI interactions and Admin settings.
> * Provide extensive mock JSON data with variations and add-ons to fully populate the UI.
> * Use `lucide-react` for exact icon matching. Ensure the code is modular and copy-pasteable.
