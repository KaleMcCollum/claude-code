# Meridian CRE Funnel — WordPress Theme

The same commercial real estate landing funnel as `../index.html`, packaged as a
WordPress theme you can personalize without touching code.

## Install (5 minutes)

1. You need a WordPress site (any host works: Bluehost, SiteGround, WP Engine,
   WordPress.com **Business plan or higher** — plugins/themes require Business).
2. Download **`meridian-funnel.zip`** from this folder.
3. In your WordPress admin, go to **Appearance → Themes → Add New Theme → Upload Theme**,
   choose the zip, click **Install Now**, then **Activate**.
4. Done — your site's homepage is now the funnel.

## Personalize it (no code)

Go to **Appearance → Customize → Funnel Content**. Every piece of text on the
page is editable there, organized by section, with a live preview as you type:

- **Branding & Contact** — firm name, accent color, phone, email
- **Hero** — eyebrow, headline, subheadline, the three terms
- **Stats Strip** — all three numbers and labels
- **Statement Section** — the big statement and three selling points
- **Testimonial Quote** — quote text and attribution
- **Final Call-to-Action** — headline, subline, button label
- **Lead Capture Form** — form titles, success message, and **where leads are emailed**
- **Footer & Legal** — your license number and disclosures

Click **Publish** when you're happy.

## Where leads go

Every form submission is:

1. Saved in your WordPress admin under the **Leads** menu (with property,
   asset type, phone, and email columns), and
2. Emailed to the address set in **Customize → Lead Capture Form**
   (defaults to your WordPress admin email).

A hidden honeypot field filters out most spam bots automatically. If emails
don't arrive, install an SMTP plugin like **WP Mail SMTP** — many hosts block
PHP mail by default.

## Ad tracking

Install your Meta Pixel / Google tag with any header-scripts plugin
(e.g. **WPCode**). The theme fires no tracking by itself.
