export const peopleGuides = [
  {
    id: "facilitators",
    section: "Facilitators and people",
    audience: ["admin"],
    icon: "users",
    title: "Add and manage facilitators",
    summary: "See everyone who hosts, spot who needs a check, edit their details and photo, verify them, and add someone new.",
    related: ["new-circle", "cofacilitators", "website-listing"],
    steps: [
      {
        title: "Open Facilitators",
        body: "Open **Circles, Facilitators**. Every person who hosts or co-hosts is listed with their photo, contact details, circles and a small strip showing how their last eight sessions went.",
        shot: "fac-1-list",
        alt: "The Facilitators page",
      },
      {
        title: "Use the filters",
        body: "The chips narrow the list: **Needs a check**, **Running well**, **No active circles**, **Unverified**, **No photo** and **No phone**. A form waiting for approval counts as no active circles yet.",
        shot: "fac-2-filters",
        alt: "The filter chips on the Facilitators page",
      },
      {
        title: "Open a person",
        body: "Click a row to open their panel. You will see their circles and a **Details** form with **Photo link**, **Upload a photo**, **Initiated name**, **Name**, **First name**, **Last name**, **Email** and **Phone**. Edit anything and click **Save details**.",
        note: "A person's names, photos and contact details are kept only here. Change them once and every circle, email and the website show the same.",
        shot: "fac-3-panel",
        alt: "A facilitator's panel with their circles and details",
      },
      {
        title: "Verify or unverify",
        body: "Approving a circle automatically verifies its people. You can also click **Verify** or **Remove verification** on the profile. A host who is not verified cannot be listed on the website before their circle is approved.",
        shot: "fac-4-verify",
        alt: "The Remove verification button on a profile",
      },
      {
        title: "Give them a circle",
        body: "In the panel, **Assign to a circle** puts them on an existing circle, and **New circle** starts a new circle with them as host, ready for the Queue.",
        shot: "fac-5-assign",
        alt: "Assign to a circle and New circle buttons",
      },
      {
        title: "Add a new facilitator",
        body: "Click **New facilitator** at the top right. Add their **First name**, **Last name**, **Email** and **Phone**, an **Initiated name** if they have one, and a photo with **Upload a photo**. Click **Add to the system**. If the email already belongs to someone on file, you are offered that person instead, so nobody is duplicated.",
        shot: "fac-6-new",
        alt: "The New facilitator panel",
      },
    ],
  },
  {
    id: "cofacilitators",
    section: "Facilitators and people",
    audience: ["admin"],
    icon: "userplus",
    title: "Add a co-facilitator or hand a circle over",
    summary: "Share a circle between two people, remove a co-host, or change who the main facilitator is.",
    related: ["facilitators", "change-requests", "manage-circle"],
    steps: [
      {
        title: "Open the circle's Facilitators section",
        body: "Open the circle from **Circles, All circles** and expand **Facilitators**. You see the **Primary facilitator** and any **Co-facilitators**, each with email and phone.",
        shot: "cofac-1-section",
        alt: "The Facilitators section of a circle",
      },
      {
        title: "Add a co-facilitator",
        body: "Click **+ Add co-facilitator** and choose someone already on file, or add a new person once. Co-facilitators see the circle in their own portal and receive its emails.",
        note: "If the Tally form named a co-host, they are added automatically when you approve the circle. On a live circle, use **Resend details email** to send them the details straight away.",
        shot: "cofac-2-add",
        alt: "The Add co-facilitator button",
      },
      {
        title: "Remove a co-facilitator",
        body: "Click **Remove** next to their name. They stop seeing the circle in their portal. Their profile is not deleted.",
      },
      {
        title: "Change the main facilitator",
        body: "Click **Change** next to the primary facilitator and pick the new person. For a live circle, they are invited and emailed the details. Facilitators can also ask for this themselves with **Hand over to another facilitator**, which you apply in **Change requests**.",
        shot: "cofac-3-change",
        alt: "The Change button next to the primary facilitator",
      },
    ],
  },
];
