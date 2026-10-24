export const zoomGuides = [
  {
    id: "licences",
    section: "Zoom and attendance",
    audience: ["admin"],
    icon: "video",
    title: "Manage Zoom licences",
    summary: "Bring in the Zoom users, give each a host key, switch licences on or off, and use mock licences for testing.",
    related: ["clash", "zoom-meetings"],
    steps: [
      {
        title: "Open Licences",
        body: "Open **Zoom, Licences**. Each row is one licensed Zoom user. The columns show its **Label**, **Zoom user email**, **Host key**, **Active**, **Mock** and how many **Circles** it runs. A note under a licence such as **2 at once: Mon** means two circles share that licence at the same time.",
        shot: "licences-1-page",
        alt: "The Zoom licences page",
      },
      {
        title: "Sync from Zoom",
        body: "Click **Sync from Zoom**. Every licensed user in your Zoom account is brought in, and any labels you chose are kept. Do this when a licence is added or changed in Zoom.",
        shot: "licences-2-sync",
        alt: "The Sync from Zoom button",
      },
      {
        title: "Set a host key",
        body: "Zoom never reveals an existing host key, so click **Set key** on each licence that will host circles to give it a new one. Its old key stops working, so skip any shared account staff already rely on. Facilitators get the key so they can **Claim host** without a password.",
        shot: "licences-3-key",
        alt: "The Set key button on a licence",
      },
      {
        title: "Switch a licence off",
        body: "Untick **Active** for any user who should not host circles, such as a shared staff account. Inactive licences are never picked by the allocator. Click **Add licence** if you need a new row.",
      },
      {
        title: "Mock licences are for testing only",
        body: "A licence marked **Mock** creates fake Zoom details when you approve a circle on it. Never leave one ticked for real circles. Use **Meetings** beside a licence to see what is on that Zoom account.",
        note: "The Overview warns you when a mock licence is in use and when a licence has no Zoom user.",
      },
    ],
  },
  {
    id: "zoom-meetings",
    section: "Zoom and attendance",
    audience: ["admin"],
    icon: "video",
    title: "See what is on Zoom",
    summary: "Compare the meetings in Zoom with the circles here, find strays, and export the list.",
    related: ["licences", "attendance"],
    steps: [
      {
        title: "Open Meetings on Zoom",
        body: "Open **Zoom, Meetings on Zoom**. The top numbers count **Weekly series**, **One-off meetings**, **Circles (made in this dashboard)** and **Other Zoom meetings**. Under them, every licence is listed with how many weekly meetings it holds.",
        shot: "zoom-1-page",
        alt: "The Meetings on Zoom page",
      },
      {
        title: "Refresh it",
        body: "Click **Sync now** to ask Zoom for its current list. The page shows what Zoom said at the last sync, so refresh it before you rely on it.",
        shot: "zoom-2-sync",
        alt: "The Sync now button",
      },
      {
        title: "Filter and open",
        body: "Use **All**, **Weekly** and **One-off**, and **All meetings**, **Circles** and **Other Zoom meetings** to narrow the list. A meeting that belongs to a circle links to it, and **Attendance →** jumps to who attended.",
      },
      {
        title: "Export",
        body: "Click **Export all (CSV)** to download the list for a spreadsheet.",
      },
    ],
  },
  {
    id: "attendance",
    section: "Zoom and attendance",
    audience: ["admin"],
    icon: "chart",
    title: "Check attendance and insights",
    summary: "See who came to each session, who has dropped off, and how the community is growing.",
    related: ["zoom-meetings", "process-overview"],
    steps: [
      {
        title: "Open Attendance",
        body: "Open **Zoom, Attendance**. The numbers across the top show **Sessions in the last 7 days**, the **Average per session (4 weeks)**, **People seen** and **Dropped off**, meaning people who came three or more times and missed the last three.",
        shot: "attendance-1-page",
        alt: "The Attendance page with its headline numbers",
      },
      {
        title: "By meeting, or by person",
        body: "Switch between **By meeting** and **By person**. By meeting lists each circle's sessions. By person shows each attendee and how many sessions they joined. Use **All meetings**, **Circles** and **Other Zoom meetings** to filter.",
        shot: "attendance-2-meeting",
        alt: "Attendance listed by meeting",
      },
      {
        title: "Bring it up to date",
        body: "Click **Sync now** to fetch the latest sessions from Zoom. The first sync back-fills about six months, which is as far back as Zoom keeps reports. After that it runs by itself overnight.",
        note: "Attendance needs a paid Zoom plan with the report permissions switched on for the Zoom app.",
      },
      {
        title: "Open Attendance insights",
        body: "Open **Zoom, Attendance insights** for trends. Choose **12 weeks** or **26 weeks**. You get **Growth: people each week**, **Do first-timers come back?**, **Consistency** and **Drop-offs**, with tabs for **Attendance**, **Growth**, **New people**, **Regulars** and **Drop-offs**.",
        shot: "insights-1-page",
        alt: "Attendance insights",
      },
      {
        title: "Follow up with people",
        body: "The **Drop-offs** tab lists people who stopped coming so facilitators can reach out. Click a circle in **Circle details** to see how that one is doing.",
      },
    ],
  },
  {
    id: "zoom-registration",
    section: "Zoom and attendance",
    audience: ["admin"],
    icon: "mail",
    title: "Collect attendees' emails on Zoom (registration)",
    summary: "Ask people joining a circle's Zoom meeting for their name and email once, so attendance shows who came by email.",
    related: ["attendance", "attendees", "zoom-meetings"],
    steps: [
      {
        title: "What it does",
        body: "With registration on, the first time someone opens the circle's join link Zoom asks for their **first name, last name and email**. They click **Register**, are approved straight away and join. They register once for the whole series and get a confirmation email with a calendar invite.\n\nThe join link and the WhatsApp link stay the same. Nothing changes in ThinkGita's Zoom account settings: it is set on one meeting at a time.",
      },
      {
        title: "Turn it on for one circle",
        body: "Open a live circle, find **Zoom details** and, under **Collect emails on Zoom**, click **Turn on**. Click **Turn off** to go back to joining without a form.",
        shot: "zoomreg-1-panel",
        alt: "Collect emails on Zoom in a circle's Zoom details",
      },
      {
        title: "Facilitators register too",
        body: "Facilitators fill in the same short form, then **Claim host** with the host key as usual. Their portal shows the extra step while registration is on.",
      },
      {
        title: "See the emails in Attendance",
        body: "After the next attendance sync, the email each person registered with appears against them in **Zoom, Attendance**, so the same person is counted once each week even if their Zoom name changes. Their earlier visits under the same Zoom name join up with that email too.\n\nWhere the email matches a sign-up, the person shows with the name from the sign-up form, a **Signed up** tag and the name they used on Zoom. Below the table, **Signed up, not seen on Zoom yet** lists people who signed up for that circle but haven't joined, ready for a follow-up.",
        note: "Emails are not checked, and every joiner fills in the form once, which takes 10 to 20 seconds. The Zoom app needs the scopes meeting:update:meeting:admin and meeting:read:list_registrants:admin.",
      },
      {
        title: "New circles",
        body: "To have every newly approved circle ask for emails, tick **Ask for name and email on new circles' Zoom meetings** in **Setup, Settings, Circle attendees**. Existing circles are only changed one by one from their panel.",
      },
    ],
  },
];
