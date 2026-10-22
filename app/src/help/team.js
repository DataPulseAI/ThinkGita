export const teamGuides = [
  {
    id: "settings",
    section: "Team and settings",
    audience: ["admin"],
    icon: "gear",
    title: "Scheduling rules, term dates and the activity log",
    summary: "Set the buffer, default length, time zone and term dates, resync Tally if something was missed, and read who changed what.",
    related: ["add-admin", "add-assessor", "licences"],
    steps: [
      {
        title: "Open Settings",
        body: "Open **Setup, Settings**. The page is a stack of cards: **Scheduling rules**, **Website**, **Admins**, **Assessors**, **Training forms (Tally)** and **Activity**.",
        shot: "settings-1-page",
        alt: "The Settings page",
      },
      {
        title: "Scheduling rules",
        body: "Set the **Buffer between meetings (min)**, which is the gap kept after each circle so an overrun does not collide with the next, the **Default length (min)** and the **Default timezone**. Click **Save**.\n\nSaving is all or nothing. If the new buffer would put three meetings on one licence at once, nothing is saved and you are told why.",
        shot: "settings-2-rules",
        alt: "The Scheduling rules card",
      },
      {
        title: "Term dates",
        body: "Set **Term starts** and **Term ends**. Zoom meetings repeat weekly from the first matching day on or after the later of the term start and the facilitator's preferred start date, until the term end, up to 50 weeks. Set these before you approve circles, or the meetings will not have a sensible end date.",
        shot: "settings-3-term",
        alt: "The term date fields",
      },
      {
        title: "Resync Tally, only if you must",
        body: "Applications and training forms arrive from Tally automatically. **Resync from Tally** is only for catching up on forms missed while the connection was off. It asks first, can only run once every 15 minutes, and makes about 14 requests to Tally, so avoid it unless you really need it.",
        shot: "settings-4-tally",
        alt: "The Training forms (Tally) card",
      },
      {
        title: "Read the Activity log",
        body: "**Activity** lists who did what and when: circles created, edited or deleted, website changes, Zoom and admin actions, and failed form intakes. Use **All**, **Circles**, **Website** and **Zoom and admin** to filter. Each line says the person and what changed, for example \"start time 19:00 to 19:30\".",
        shot: "settings-5-activity",
        alt: "The Activity log",
      },
    ],
  },
  {
    id: "add-admin",
    section: "Team and settings",
    audience: ["super"],
    icon: "shield",
    title: "Add and remove admins (super admins)",
    summary: "Invite a new admin, make someone a super admin, rename admins and remove access.",
    related: ["settings", "add-assessor"],
    steps: [
      {
        title: "What the roles mean",
        body: "Every **admin** can use the whole dashboard. **Super admins** can do that and also add or remove admins and choose who else is a super admin. There must always be at least one super admin. Only super admins see this guide.",
      },
      {
        title: "Open the Admins card",
        body: "Open **Setup, Settings** and scroll to **Admins**. Everyone with access is listed, and super admins carry a **Super admin** badge. You can set each person's display name, which is how their emails are signed.",
        shot: "admins-1-card",
        alt: "The Admins card",
      },
      {
        title: "Add an admin",
        body: "Type their email under the list and click **Add admin**. They are emailed an invite to choose a password. If they already have an account, they can just sign in.",
        shot: "admins-2-add",
        alt: "The Add admin field",
      },
      {
        title: "Resend an invite",
        body: "If someone has not received their invite, click **Send invite** beside their name.",
      },
      {
        title: "Make or remove a super admin",
        body: "Click **Make super admin** or **Remove super admin** beside someone and confirm. They stay an admin. To take someone's access away completely, click **Remove**.",
        shot: "admins-3-super",
        alt: "Make super admin and Remove buttons",
      },
    ],
  },
  {
    id: "add-assessor",
    section: "Team and settings",
    audience: ["admin"],
    icon: "shield",
    title: "Add a candidate assessor",
    summary: "Invite someone to review trainees assigned to them, without giving them access to the rest of the dashboard.",
    related: ["training-assess", "tour-assessor"],
    steps: [
      {
        title: "What an assessor can do",
        body: "A candidate assessor signs in and sees **only the trainees assigned to them**: their answers, videos and the five-criteria assessment. They cannot send emails, change a status or decide an outcome. Admins make the final decision.",
      },
      {
        title: "Open the Assessors card",
        body: "Open **Setup, Settings** and scroll to **Assessors**. Existing assessors are listed with how many trainees are assigned to each.",
        shot: "assessors-1-card",
        alt: "The Assessors card",
      },
      {
        title: "Add and invite",
        body: "Enter their **Name** and **Email** and click **Add and invite**. They get an email to choose a password. Someone who is already an admin cannot be added as an assessor, because admins can do everything already. If they also facilitate, they can switch to their facilitator portal.",
        shot: "assessors-2-add",
        alt: "The Name and Email fields with Add and invite",
      },
      {
        title: "Assign them trainees",
        body: "Go to **Training** and assign trainees to them from the **Assessor** column. See the guide on assigning and assessing.",
      },
      {
        title: "Remove an assessor",
        body: "Click **Remove** beside their name. Their trainees become unassigned so you can give them to someone else. Use **Send invite** if they need their sign-in email again.",
      },
    ],
  },
];
