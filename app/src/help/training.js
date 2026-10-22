export const trainingGuides = [
  {
    id: "training-trainees",
    section: "Facilitator training",
    audience: ["admin"],
    icon: "cap",
    title: "Review trainees and send the next form",
    summary: "Follow each applicant through the seven training steps, send them their next form, and chase the ones who have gone quiet.",
    related: ["training-matching", "training-assess", "training-emails"],
    steps: [
      {
        title: "How training works",
        body: "Each person who applies becomes a **trainee**. They work through seven steps, shown as dots: intro session, agreement, Setting the Scene, Empowerment, Wisdom, video assessment and closing session. Forms arrive from Tally by themselves, so there is nothing to import.",
      },
      {
        title: "Open Training",
        body: "Click **Training** in the menu. The **Trainees** tab lists everyone with their dots, and filters for **Applied**, **In training**, **Ready to assess**, **Certified**, **Not certified**, **Cancelled** and **Revoked**. A trainee is **Ready to assess** when all seven steps are done.",
        shot: "training-1-list",
        alt: "The Trainees list",
      },
      {
        title: "Open a trainee",
        body: "Click a row. The panel shows their contact details, a checklist of the steps with each form's answers, **Send a form**, **Personal form links**, the **Assessment** and the **Outcome**. Video answers play in the panel.",
        shot: "training-2-panel",
        alt: "A trainee panel",
      },
      {
        title: "Mark the sessions",
        body: "The intro and closing sessions are marked by hand. In the panel, mark each as attended once the trainee has joined. Everything else is ticked off automatically when their form comes in.",
      },
      {
        title: "Send the next form",
        body: "Open the **Next steps** tab. Trainees are grouped by the form they should do next. Click **Send** beside one person, or **Send to all** for the group. Each email is personal: their first name, the form's name and their own link.",
        note: "Send one to your own address first and check it looks right before you use **Send to all**. Emails go out slowly, about 20 at a time, and stop if the mailbox complains.",
        shot: "training-3-next",
        alt: "The Next steps tab",
      },
      {
        title: "Chase quiet trainees",
        body: "Below the groups, **Chase** lists people who were sent a form more than five days ago and have not submitted it. Click **Resend** to nudge them.",
        shot: "training-4-chase",
        alt: "The Chase list",
      },
      {
        title: "Personal links",
        body: "Each trainee has their own form links, which carry their ID so the forms match them automatically. In the panel, open **Personal form links** and use **Copy** or **Copy all links** if you want to send them yourself.",
        shot: "training-5-links",
        alt: "Personal form links",
      },
    ],
  },
  {
    id: "training-matching",
    section: "Facilitator training",
    audience: ["admin"],
    icon: "link",
    title: "Match a form to the right trainee",
    summary: "When a form arrives from an email we do not recognise, link it to the right person so nothing is lost.",
    related: ["training-trainees"],
    steps: [
      {
        title: "Why forms go unmatched",
        body: "A form is matched to a trainee by the personal link they used, or failing that by their email, or by another email you have linked to them. If someone fills in a form from a different address, it lands in **Needs matching**.",
      },
      {
        title: "Open Needs matching",
        body: "Open **Training** and choose the **Needs matching** tab. There is one row per unknown email, showing the forms it sent and the name given.",
        shot: "matching-1-page",
        alt: "The Needs matching tab",
      },
      {
        title: "Check the suggestion",
        body: "We suggest a trainee from the name, or from an email that looks like their name. We never merge on our own, so you always confirm.",
        shot: "matching-2-row",
        alt: "A row with a suggested trainee",
      },
      {
        title: "Link them",
        body: "Click **Same person: link**. Every form from that email moves to the trainee, and the address is remembered for future forms. You can see it later under **Also uses** in their panel.",
        note: "Earlier application rounds are tucked behind a toggle so this list stays focused on the current round.",
      },
    ],
  },
  {
    id: "training-assess",
    section: "Facilitator training",
    audience: ["admin"],
    icon: "check",
    title: "Assign an assessor, assess and decide the outcome",
    summary: "Hand a trainee to an assessor, record the five criteria, and finish with Certified, Not certified, Cancelled or Revoked.",
    related: ["add-assessor", "training-emails", "ass-score"],
    steps: [
      {
        title: "Assign trainees to an assessor",
        body: "In the **Trainees** list, use the dropdown in the **Assessor** column on a row. Or tick several trainees and choose **Assign selected to…**. You can also use **Assigned to** inside a trainee's panel. Admins and super admins can be chosen as well as candidate assessors. Nobody can be assigned their own record. Assigning does not send an email.",
        shot: "assess-1-assign",
        alt: "The Assessor column on the Trainees list",
      },
      {
        title: "Record the assessment",
        body: "Open the trainee and expand **Assessment**. Rate each of the five criteria **Meets**, **Partly** or **Not yet**, with a note: **Delivery and communication**, **Understanding and fidelity**, **Facilitation readiness**, **Alignment with ethos** and **Technical quality**. Add **Overall feedback**, which can go into the outcome email. Assessors do exactly the same in their own view.",
        shot: "assess-2-criteria",
        alt: "The five assessment criteria",
      },
      {
        title: "Decide the outcome",
        body: "Expand **Outcome** and choose one:\n\n- **Certified**: they are ready to facilitate. The email includes the link to request a circle.\n- **Not certified**: not ready this time. They can train again.\n- **Cancelled**: training stopped, nothing against them, and they can apply again.\n- **Revoked**: permanent. Future applications from that email arrive as Revoked.",
        shot: "assess-3-outcome",
        alt: "The Outcome section",
      },
      {
        title: "What Revoked does",
        body: "If the person also facilitates, their facilitator record is marked revoked and unverified and cannot be verified again, and their circles come off the website. Circles keep running until an admin ends them. They also lose any assessor access. Use Revoked with care.",
        note: "A certified trainee who later becomes a facilitator, using the same email, is linked and verified automatically unless they have been revoked.",
      },
      {
        title: "Send the outcome email",
        body: "Each outcome has an optional email you can read and edit before it goes. Only admins make the final decision. Assessors can record their view but cannot change the status or send anything.",
      },
    ],
  },
  {
    id: "training-emails",
    section: "Facilitator training",
    audience: ["admin"],
    icon: "mail",
    title: "Edit the training emails",
    summary: "Change the wording of the next-form email and the four outcome emails.",
    related: ["training-trainees", "training-assess"],
    steps: [
      {
        title: "Open Email wording",
        body: "Open **Training** and choose the **Email wording** tab. There is one email for **Next form**, **Certified**, **Not certified**, **Cancelled** and **Revoked**.",
        shot: "tremail-1-page",
        alt: "The Email wording tab",
      },
      {
        title: "Edit and save",
        body: "Change the text. Placeholders such as the trainee's first name, the form's name and their personal link are filled in for each person. Save when you are happy.",
      },
      {
        title: "Know the limits",
        body: "Training emails go out one at a time with a short pause, 20 per batch, and stop if the mailbox refuses to send. There is a cap of 300 training emails every 24 hours. Every email is logged in **Setup, Sent emails**.",
      },
    ],
  },
];
