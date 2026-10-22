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
];
