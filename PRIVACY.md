# Stock Watch Privacy Policy

Effective date: September 15, 2026

Stock Watch is a Chrome extension maintained through [MasoodMS95/Stock-Watch](https://github.com/MasoodMS95/Stock-Watch). Its purpose is to monitor product availability in tabs you select, notify you, and optionally attempt supported cart actions. You complete the purchase yourself.

## Information the extension handles

For watched tabs, Stock Watch processes product URLs and titles, selected buttons, page-loading state, purchase-button availability, cart quantities, and recognized store messages. It stores watch preferences, activity timestamps, pause reasons and limited diagnostic information locally in Chrome. It can read tab information to identify the active product and coordinate watched tabs; it does not upload your browsing history to the developer.

The extension uses your existing store login session through normal browser pages. It does not ask you to enter credentials into the extension, read cookies, or store account passwords. The optional Nintendo autofill-confirmation feature checks whether a password field has been autofilled and can click the confirmation control. It does not read the password's contents. You handle unfilled passwords, two-factor authentication and security challenges yourself.

## Storage and diagnostics

Watch preferences and state use Chrome's local extension storage. Diagnostic logs use local browser storage and are enabled by default. They contain watch progress, errors, pause reasons and limited page facts, rather than full page HTML or screenshots. Logs apply redaction to recognized sensitive patterns, but an exported report can still contain product information, URLs and page-related messages.

Logs retain up to 48 hours, subject to limits of 6,000 routine entries and 500 incidents. Heavy activity can shorten that history. You can stop logging, clear logs or export a report using Help & troubleshooting logs. Watch preferences remain until removed or the extension's data is cleared. Uninstalling the extension removes its browser-managed local data; exported files remain wherever you saved them.

## Optional phone alerts

Phone alerts are off until you enable them. When enabled, Stock Watch sends notification titles, text, product links and a randomly generated notification topic to https://ntfy.sh over HTTPS. Product-link query strings and fragments are stripped before transmission. As with other network services, the provider receives network information such as the connection's IP address. Its handling of data is governed by its own policies: https://ntfy.sh/docs/privacy/.

The topic is not a password-protected inbox. Anyone who knows it can subscribe to or publish messages on it. Keep it private. Disable phone alerts in the extension to stop future delivery; messages already delivered are subject to the provider's retention practices and your phone's storage.

## Sharing and use

The developer does not operate an analytics or advertising collection endpoint in this extension. Data is not sold, used for advertising, or transferred to data brokers. Information handled by the extension is used to provide its product-monitoring, notification, cart-assistance and troubleshooting functions. Optional phone delivery is described above. Store interactions are sent to the store through your selected browser tabs.

Diagnostic reports are sent to the developer only if you choose to share them, for example in a GitHub issue. Review reports before posting; public issues can be read by anyone. Do not include credentials, private notification topics, payment information or addresses.

Stock Watch's use of information is limited to its user-facing purpose and follows the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Contact and changes

For privacy questions, open an issue at https://github.com/MasoodMS95/Stock-Watch/issues without including sensitive information. Updates to this policy will be published here with a revised effective date.
