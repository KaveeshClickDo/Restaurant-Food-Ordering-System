import type { FooterPage } from "@/types";

export const DEFAULT_FOOTER_PAGES: FooterPage[] = [
  {
    slug: "about-us",
    title: "About Us",
    enabled: true,
    lastModified: new Date(0).toISOString(),
    content: `<h2>About Us</h2>
<p>Welcome to our restaurant, where great food meets modern convenience. Founded with a passion for genuine flavours and quality ingredients, we have been proudly serving our local community for years.</p>
<p>Our kitchen is led by experienced chefs who source only the finest fresh ingredients to create dishes that are as nourishing as they are delicious.</p>
<h3>Our Values</h3>
<ul>
<li><strong>Quality</strong> — Only the freshest ingredients, prepared fresh daily.</li>
<li><strong>Authenticity</strong> — Recipes crafted with care and tradition.</li>
<li><strong>Community</strong> — Proud to serve our local neighbourhood.</li>
<li><strong>Convenience</strong> — Fast delivery and easy collection, seven days a week.</li>
</ul>
<p>Thank you for choosing us. We hope to serve you soon!</p>`,
  },
  {
    slug: "contact-us",
    title: "Contact Us",
    enabled: true,
    lastModified: new Date(0).toISOString(),
    content: `<h2>Contact Us</h2>
<p>We would love to hear from you. Reach us through any of the channels below and we will get back to you as soon as possible.</p>
<h3>Address</h3>
<p>42 Curry Lane<br>London<br>E1 6RF<br>United Kingdom</p>
<h3>Phone</h3>
<p><a href="tel:02071234567">020 7123 4567</a></p>
<h3>Email</h3>
<p><a href="mailto:hello@restaurant.co.uk">hello@restaurant.co.uk</a></p>
<h3>Opening Hours</h3>
<p>Monday – Friday: 11:00 – 22:00<br>Saturday – Sunday: 10:00 – 23:00</p>
<h3>Large Orders & Catering</h3>
<p>For group orders, catering enquiries, or any other questions, please call or email us directly. We respond to all emails within 24 hours.</p>`,
  },
  {
    slug: "terms",
    title: "Terms of Service",
    enabled: true,
    lastModified: new Date(0).toISOString(),
    content: `<h2>Terms of Service</h2>
<p><em>Last updated: January 2026</em></p>
<p>By placing an order with us, you agree to the following terms and conditions.</p>
<h3>1. Orders &amp; Payment</h3>
<p>All orders are subject to availability. Prices displayed are inclusive of VAT where applicable. Payment must be made at the time of ordering unless the Cash on Delivery option is selected and available in your area.</p>
<h3>2. Delivery</h3>
<p>We aim to deliver within the estimated time shown at checkout. Delivery times may vary depending on demand, weather conditions, or other factors outside our control. We are not liable for delays caused by circumstances beyond our reasonable control.</p>
<h3>3. Cancellations &amp; Refunds</h3>
<p>Orders may be cancelled within 5 minutes of being placed. Once preparation has begun, cancellations are at the discretion of the restaurant. Refunds for cancelled or incorrect orders will be processed within 5 working days.</p>
<h3>4. Allergens</h3>
<p>Our food is prepared in a kitchen that handles nuts, dairy, gluten, and other allergens. Please contact us before ordering if you have any dietary requirements or food allergies. We cannot guarantee allergen-free preparation.</p>
<h3>5. Contact</h3>
<p>For queries about these terms, please contact us at <a href="mailto:hello@restaurant.co.uk">hello@restaurant.co.uk</a> or call 020 7123 4567.</p>`,
  },
  {
    slug: "privacy",
    title: "Privacy Statement",
    enabled: true,
    lastModified: new Date(0).toISOString(),
    content: `<h2>Privacy Statement</h2>
<p><em>Last updated: January 2026</em></p>
<p>We are committed to protecting your personal data. This statement explains how we collect, use, store, and protect your information in accordance with UK GDPR.</p>
<h3>Data We Collect</h3>
<ul>
<li>Name, email address, and phone number provided at checkout or registration</li>
<li>Delivery address for delivery orders</li>
<li>Order history for registered customers</li>
<li>Usage data collected through analytics cookies (if applicable)</li>
</ul>
<h3>How We Use Your Data</h3>
<p>We use your personal data solely to process and fulfil your orders and to send order status notifications. We do not sell or share your data with third parties, except where required to process payment (e.g. Stripe, PayPal).</p>
<h3>Data Retention</h3>
<p>Order and account data is retained for up to 12 months for accounting and legal compliance purposes. You may request deletion of your personal data at any time by contacting us.</p>
<h3>Your Rights</h3>
<p>Under UK GDPR you have the right to access, correct, restrict, or delete your personal data. To exercise any of these rights, please contact us at <a href="mailto:hello@restaurant.co.uk">hello@restaurant.co.uk</a>.</p>`,
  },
  {
    slug: "cookies",
    title: "Cookie Statement",
    enabled: true,
    lastModified: new Date(0).toISOString(),
    content: `<h2>Cookie Statement</h2>
<p><em>Last updated: January 2026</em></p>
<p>This website uses cookies and similar technologies to improve your browsing experience and help us understand how our site is used.</p>
<h3>What Are Cookies?</h3>
<p>Cookies are small text files stored on your device when you visit a website. They allow the site to remember your preferences and actions over a period of time.</p>
<h3>Cookies We Use</h3>
<ul>
<li><strong>Essential cookies</strong> — Required for the website to function correctly, including your shopping cart and login session. These cannot be disabled.</li>
<li><strong>Preference cookies</strong> — Remember your choices such as delivery or collection preference.</li>
<li><strong>Analytics cookies</strong> — Help us understand how visitors interact with our site so we can improve it. These are only set if you consent.</li>
</ul>
<h3>Managing Cookies</h3>
<p>You can control and delete cookies through your browser settings. Please note that disabling essential cookies may prevent some parts of the website from functioning correctly.</p>
<h3>Contact</h3>
<p>If you have questions about our use of cookies, please contact us at <a href="mailto:hello@restaurant.co.uk">hello@restaurant.co.uk</a>.</p>`,
  },
  {
    slug: "accessibility",
    title: "Accessibility",
    enabled: true,
    lastModified: new Date(0).toISOString(),
    content: `<h2>Accessibility</h2>
<p>We are committed to making our website accessible to everyone, including people with disabilities. We believe that all of our customers deserve the same quality of experience.</p>
<h3>Our Commitment</h3>
<p>We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.1 at Level AA. We review our website regularly and work continuously to improve accessibility where possible.</p>
<h3>Accessibility Features</h3>
<ul>
<li>Full keyboard navigation support throughout the site</li>
<li>Sufficient colour contrast for readability in all UI areas</li>
<li>Descriptive alt text for all meaningful images</li>
<li>Responsive design for all screen sizes, from mobile to desktop</li>
<li>Clear focus indicators for interactive elements</li>
</ul>
<h3>Known Issues</h3>
<p>We are aware that some older parts of the site may not fully meet accessibility standards. We are actively working to address these issues.</p>
<h3>Get Help</h3>
<p>If you experience any difficulty accessing our website or need content in an alternative format, please contact us and we will do our best to assist you.</p>
<p>Email: <a href="mailto:hello@restaurant.co.uk">hello@restaurant.co.uk</a><br>
Phone: <a href="tel:02071234567">020 7123 4567</a></p>`,
  },
];
