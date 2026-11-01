# NeuroFront confirmation email

`confirmation-email.html` is the email body for Supabase's **Confirm sign up** template. `email-preview.html` is a labelled, non-functional browser preview. The preview does not send mail or verify an account.

Subject: **Confirm your NeuroFront email**

The design uses the existing NeuroFront logo, a navy header, warm white content and a mint confirmation button. It uses inline CSS and presentation tables with system fonts. There are no scripts, tracking pixels, user-provided markup or invented expiry times. The email remains understandable when images are blocked.

## Delivery requirement

The NeuroFront Supabase project (`feblbpepamcklqgoemyt`) was created on 1 November 2026 on the free plan. New free projects cannot change authentication email templates while using Supabase's default mail provider. A custom SMTP provider enables custom templates without requiring an application rewrite. See the [Supabase policy](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier).

The template is prepared, but it is **not installed as the live authentication email**. No custom SMTP provider or verified sender domain has been supplied. Publishing the HTML preview to Vercel does not change the email Supabase sends.

## Enable the branded email

1. Choose an email provider that supports SMTP and verify a sender domain you control using that provider's DNS instructions. The existing `neurofrontui.vercel.app` hosting address is not a sender domain you control in DNS.
2. In the [NeuroFront Supabase project](https://supabase.com/dashboard/project/feblbpepamcklqgoemyt), open Authentication's email/SMTP settings. Enter the provider's host, port, username and SMTP password. Set the sender name to **NeuroFront** and use an address on your verified sender domain. Keep these credentials in Supabase's settings, not browser code, Git or chat.
3. Disable email open/click tracking for authentication emails so verification links are not rewritten. Keep email confirmation enabled.
4. Open [Email Templates](https://supabase.com/dashboard/project/feblbpepamcklqgoemyt/auth/templates), choose **Confirm sign up**, set the subject above and paste the complete contents of `confirmation-email.html` into its HTML body. Save the template.
5. Keep the production Site URL and allowed redirect URL set to `https://neurofrontui.vercel.app/`. The existing application requests the dashboard's account callback and handles the provider-managed PKCE session. The template intentionally uses `{{ .ConfirmationURL }}` unchanged for its action and fallback link. Do not replace it with a hardcoded homepage or construct your own token.
6. Register a test account you control through the dashboard. Check the sender, subject, logo, message, button and fallback link in your actual mail client. Open the link in the browser used to register, confirm the dashboard callback, then sign out and sign in again. A browser preview alone does not establish Gmail/Outlook compatibility or successful mail delivery.

This change customizes confirmation emails only. Password recovery and other authentication templates retain their current content until separately customized.

## Verification

The template and preview are checked at desktop and narrow mobile browser widths. The preview contains no real verification token and its confirmation control is inactive. Live delivery and provider-side template installation remain pending SMTP configuration. No messages have been sent as part of creating this design.

Official references: [Email templates and confirmation variables](https://supabase.com/docs/guides/auth/auth-email-templates), [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
