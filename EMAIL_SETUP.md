# NeuroFront account emails

These HTML files are prepared for Supabase's authentication templates. Their labelled browser previews do not send mail, verify an account or change a password.

| Supabase template | Email body | Subject | Browser preview |
| --- | --- | --- | --- |
| Confirm sign up | `confirmation-email.html` | Confirm your NeuroFront email | `email-preview.html` |
| Reset password | `recovery-email.html` | Reset your NeuroFront password | `recovery-email-preview.html` |

Both designs use the existing NeuroFront logo, a navy header, warm white content and a mint action button. They use inline CSS and presentation tables with system fonts. There are no scripts, tracking pixels, user-provided markup or invented expiry times. The emails remain understandable when images are blocked.

## Delivery requirement

The NeuroFront Supabase project (`feblbpepamcklqgoemyt`) was created on 1 November 2026 on the free plan. New free projects cannot change authentication email templates while using Supabase's default mail provider. A custom SMTP provider enables custom templates without requiring an application rewrite. See the [Supabase policy](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier).

The templates are prepared, but they are **not installed as the live authentication emails**. No custom SMTP provider or verified sender domain has been supplied. Publishing the HTML previews to Vercel does not change the emails Supabase sends. The existing sign-up and forgot-password flows continue using their current provider templates.

## Enable the branded emails

1. Choose an email provider that supports SMTP and verify a sender domain you control using that provider's DNS instructions. The existing `neurofrontui.vercel.app` hosting address is not a sender domain you control in DNS.
2. In the [NeuroFront Supabase project](https://supabase.com/dashboard/project/feblbpepamcklqgoemyt), open Authentication's email/SMTP settings. Enter the provider's host, port, username and SMTP password. Set the sender name to **NeuroFront** and use an address on your verified sender domain. Keep these credentials in Supabase's settings, not browser code, Git or chat.
3. Disable email open/click tracking for authentication emails so verification links are not rewritten. Keep email confirmation enabled.
4. Open [Email Templates](https://supabase.com/dashboard/project/feblbpepamcklqgoemyt/auth/templates). For **Confirm sign up**, use the confirmation subject and the complete contents of `confirmation-email.html`. For **Reset password**, use the recovery subject and the complete contents of `recovery-email.html`. Save each template separately.
5. Keep the production Site URL and allowed redirect URL set to `https://neurofrontui.vercel.app/`. The existing application requests the dashboard's account callback for sign-up and its account-recovery callback for password resets, and handles the provider-managed PKCE session. Both templates intentionally use `{{ .ConfirmationURL }}` unchanged for their action and fallback link. Supabase supplies the appropriate flow-specific URL. Do not replace it with a hardcoded homepage or construct your own token.
6. Register a test account you control through the dashboard. Check the sender, subject, logo, message, button and fallback link in your actual mail client. Open the link in the browser used to register, confirm the dashboard callback, then sign out and sign in again. A browser preview alone does not establish Gmail/Outlook compatibility or successful mail delivery.
7. To test recovery, open the dashboard's profile button, choose **Sign In**, then **Forgot password**. Request the reset for an account you control. Open its email in the browser that requested it, follow the recovery link and choose a new password in the dashboard popup. Confirm the new password works. The preview's reset button is intentionally inactive and cannot perform this test.

Other authentication templates retain their current content until separately customized. No password is collected through an email or preview page.

## Verification

Both templates and previews are checked at desktop and narrow mobile browser widths, including long-link wrapping. The previews contain no real verification or recovery tokens and their action controls are inactive. Live delivery and provider-side template installation remain pending SMTP configuration. No messages have been sent as part of creating these designs.

Official references: [Email templates and confirmation variables](https://supabase.com/docs/guides/auth/auth-email-templates), [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
