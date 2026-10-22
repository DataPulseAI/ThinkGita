export const websiteEmailGuides = [
  {
    id: "website-listing",
    section: "Website and emails",
    audience: ["admin"],
    icon: "globe",
    title: "Put a circle on the website",
    summary: "Switch a circle on, see what is missing, and check what visitors will see before it goes live.",
    related: ["process-overview", "facilitators", "settings"],
    steps: [
      {
        title: "How listing works",
        body: "Circles are listed in the **Course** collection of the ThinkGita website. Each circle is hidden unless its **Website** switch is on, and it only shows once everything needed is filled in. Any change you make here updates the website automatically within a couple of minutes.",
      },
      {
        title: "Open the Website preview",
        body: "Open **Setup, Website**. The page is split into **On the website**, **Ready to show** and **Not ready yet**. Each card shows what visitors will see: the title, time, start line, host name and photo.",
        shot: "website-1-page",
        alt: "The Website preview page",
      },
      {
        title: "Show or hide a circle",
        body: "On a card in **Ready to show**, click **Show** to list it. On a card in **On the website**, click **Hide** to take it down again. **Open** takes you to the circle. Hiding never deletes anything, the listing simply becomes a draft.",
        shot: "website-2-show",
        alt: "A card with the Show button highlighted",
      },
      {
        title: "Fill in what is missing",
        body: "A circle that is switched on but not complete stays hidden and says what is missing. To be listed it needs: a **photo** (the circle's own, or its host's), a **display name**, a **WhatsApp group link**, a **start date** that is today or later (for circles not yet running), a day, time and time zone, a **language** and a **website order**.\n\nOpen the circle and go to its **Website** section. It shows a checklist and a form for the photo, card name and order.",
        shot: "website-3-circle",
        alt: "The Website section in a circle panel",
      },
      {
        title: "Order and photos",
        body: "**Website order** decides where the circle sits in the list. A photo can be pasted as a link or uploaded. Host photos are kept on the person, so adding one on their profile fixes every circle they run.",
      },
      {
        title: "Publishing",
        body: "By default the site is published after each update. If the website host refuses a publish, the dashboard says so and retries by itself a few minutes later. You can turn automatic publishing off in **Setup, Settings, Website** while someone is redesigning the site, because publishing also puts any unpublished design edits live.",
        note: "**Update all circles now** in Settings sends every circle to the website again. You rarely need it.",
        shot: "website-4-settings",
        alt: "The Website section of Settings",
      },
    ],
  },
  {
    id: "email-templates",
    section: "Website and emails",
    audience: ["admin"],
    icon: "mail",
    title: "Edit emails and check what was sent",
    summary: "Change the approval and details-changed emails, send yourself a test, and see or resend anything that failed.",
    related: ["queue-approve", "manage-circle"],
    steps: [
      {
        title: "Open Email templates",
        body: "Open **Setup, Email templates**. At the top, **Links and contacts** holds the shared links used in emails: the Google Drive folder, the support contact, an optional default YouTube playlist and the **Request a Circle form** link. Below that, **Facilitator emails** has two emails to edit.",
        shot: "emails-1-links",
        alt: "Links and contacts at the top of Email templates",
      },
      {
        title: "Pick which email to edit",
        body: "Choose **Approval email**, sent when you approve a circle, or **Details changed**, sent when a live circle's time or licence changes. The email is plain text with `{{placeholders}}` such as `{{first_name}}` and `{{zoom_meeting_link}}`.",
        shot: "emails-2-editor",
        alt: "The email editor",
      },
      {
        title: "Insert a placeholder",
        body: "Click any placeholder name in the list to insert it where your cursor is. When the email is sent, each one is replaced by the real value for that circle. Lines written in CAPITALS become headings, and links become clickable.",
        shot: "emails-3-placeholders",
        alt: "The list of placeholders",
      },
      {
        title: "Preview and send a test",
        body: "The preview uses a real circle. Click **Send test to me** to email the current draft to yourself before you save. **Undo changes** goes back to the last saved version and **Reset to original** restores the standard wording.",
        shot: "emails-4-test",
        alt: "The Send test to me button",
      },
      {
        title: "Check Sent emails",
        body: "Open **Setup, Sent emails** to see every facilitator email and sign-in invite, whether it was **Sent**, **Failed or not sent**, and to whom. Click a row to read the email in full.",
        shot: "emaillog-1-page",
        alt: "The Sent emails page",
      },
      {
        title: "Resend a failed email",
        body: "Filter by **Failed or not sent** and click **Resend** on the row. Failures also show as a banner on the Overview with a **See which** link. Password reset and sign-in link emails come from the sign-in system and only appear in the team inbox's Sent folder.",
        note: "Emails are signed by the admin who sends them. Set your name in **Setup, Settings, Admins**.",
      },
    ],
  },
];
