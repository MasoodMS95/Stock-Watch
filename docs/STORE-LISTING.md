# Chrome Web Store submission

Submission status: prepared locally; not uploaded or submitted for review.

## Listing fields

Name: Personal Stock Watch

Summary: Watch product availability, get desktop or phone alerts, and optionally try adding one item to your cart.

Category: Shopping

Language: English

Website: https://github.com/MasoodMS95/Stock-Watch

Support URL: https://github.com/MasoodMS95/Stock-Watch/issues

Privacy policy URL: https://github.com/MasoodMS95/Stock-Watch/blob/main/PRIVACY.md

## Description

Keep an eye on the products you want without repeatedly checking every tab yourself.

Open a product page, choose a refresh interval, and click Watch this page. Stock Watch can notify you when a purchase button becomes available. You can also opt into a supported cart attempt for one item. You always complete the purchase yourself.

Features:
- Simple setup directly from the product tab, including sold-out pages.
- Refresh intervals in seconds or minutes.
- Desktop notifications and optional phone alerts through ntfy.
- Pause and resume individual watches or all watches.
- Optional tab activation, or independent watches in separate windows.
- Built-in rules for US Amazon, Best Buy, Nintendo, Walmart and GameStop.
- Optional cart assistance with store-specific inventory checks and queue protection.
- Local troubleshooting logs you can review and export.

Keep Chrome open and your computer awake. Browser scheduling and page loading can delay checks. Purchase buttons, queues and cart additions do not guarantee inventory. Compatibility varies by product and retailer layout; some checkout flows require manual handling. The special Amazon preorder checkout-entry flow is currently limited to the originally supported console. Stock Watch never places the final order.

Phone alerts are optional and transmit alert content through ntfy.sh. Keep the generated topic private. Watch settings and diagnostic logs stay locally in Chrome unless you export and share a report. Sign in to stores normally; you do not enter passwords into Stock Watch. Security challenges and two-factor authentication remain manual.

This community preview is not affiliated with the listed retailers.

## Single purpose

Monitor availability of products in user-selected tabs and help the user act on an availability event through notifications and optional guarded cart assistance.

## Permission explanations

- alarms: Schedule watched-page refreshes, pending-result checks and optional phone-delivery retries while the service worker is suspended.
- storage: Save watch settings, pause states, pending attempts, notification preferences and bounded local diagnostic data.
- tabs: Identify the selected product tab and access its URL/title; refresh watched tabs and optionally bring them forward. Used to protect queues and cart attempts from conflicting navigation.
- scripting: Inspect purchase controls and store results in pages the user permits, and execute explicitly enabled guarded cart actions.
- notifications: Deliver availability and attention alerts on the desktop.
- Optional host access: A store origin is requested when the user adds a watch, rather than granting access to every website at installation. Broad optional patterns support user-selected product pages and custom selectors. ntfy.sh access is requested only for phone alerts. accounts.nintendo.com access is requested only for optional autofilled-password confirmation.

Remote code: No. Executable code is included in the package; ntfy is used only for notification delivery, not to download executable code.

## Privacy disclosures to enter accurately

Declare Website content (product titles, button labels, cart and availability messages), Web history (watched product URLs and titles), and User activity (watch events, configured actions and resulting state). These are handled for the extension's purpose, mostly locally; optional alerts transmit selected notification content to ntfy.sh. Do not claim that no user data is handled or transmitted. The dashboard's final wording and categories must be checked against the live form before submission.

The extension does not collect password contents, payment credentials, health information, personal communications or location coordinates. Store fulfillment uses the user's existing selection; no address or payment field is intentionally collected by the extension. Third-party network metadata is described in the privacy policy.

## Reviewer testing notes

1. Load the extension and open an ordinary product page on a supported US retailer.
2. Add a watch in notification-only mode and allow that origin. Test notification verifies the desktop path without a purchase.
3. Inspect pause/resume and interval controls. No developer-hosted account is needed.
4. Cart assistance is opt-in and may need a retailer login and an available product. Never submit a final order. Compatibility is described in the README.
5. Phone alerts require optional ntfy access and an external subscriber; they are off by default.

## Files and remaining account steps

Upload the runtime-only ZIP, the 128px icon, a 440×280 promotional image, and a 1280×800 screenshot. Do not upload the repository source ZIP with test fixtures as the store runtime package.

The developer dashboard must still be checked for account registration, verified contact information, any registration fee, account-specific declarations, listing validation and review submission. Do not invent contact information or legal/trader status. Publication depends on Google's review.
