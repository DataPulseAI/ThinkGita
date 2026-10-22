export const assessorGuides = [
  {
    id: "ass-review",
    section: "Assessing trainees",
    audience: ["assessor"],
    icon: "cap",
    title: "Find your trainees and review their answers",
    summary: "Open a trainee, read what they wrote and watch their video.",
    related: ["ass-score", "tour-assessor"],
    steps: [
      {
        title: "See who is assigned to you",
        body: "After you sign in, **Trainees assigned to you** lists everyone you have been asked to assess, with a row of dots showing how far through the seven steps they are. A trainee with every dot filled is **Ready to assess**.",
        shot: "ass-1-list",
        alt: "The trainees assigned to you",
      },
      {
        title: "Open a trainee",
        body: "Click their row. A panel opens with their name, contact details and a checklist of the training steps.",
        shot: "ass-2-panel",
        alt: "A trainee panel in the assessor view",
      },
      {
        title: "Read their answers",
        body: "Under **Training**, each completed form has an **Answers** link. Click it to read what they wrote for that step. The **Application** section shows their original application.",
        shot: "ass-3-answers",
        alt: "A form's answers",
      },
      {
        title: "Watch the video",
        body: "In the video assessment answers, click **Play** to watch their practice session in the panel. The link is fetched fresh each time you press Play, so it always works.",
        shot: "ass-4-video",
        alt: "The video answer with a Play button",
      },
    ],
  },
  {
    id: "ass-score",
    section: "Assessing trainees",
    audience: ["assessor"],
    icon: "star",
    title: "Score the five criteria and give feedback",
    summary: "Rate each criterion, add notes and overall feedback. The admins then make the final decision.",
    related: ["ass-review"],
    steps: [
      {
        title: "Open the Assessment section",
        body: "In a trainee's panel, expand **Assessment**. It shows how many of the five criteria you have rated so far, for example \"0 of 5 rated\".",
        shot: "score-1-section",
        alt: "The Assessment section",
      },
      {
        title: "Rate each criterion",
        body: "For each criterion choose **Meets**, **Partly** or **Not yet**, and add a short note: **Delivery and communication**, **Understanding and fidelity**, **Facilitation readiness**, **Alignment with ethos** and **Technical quality**.",
        shot: "score-2-criteria",
        alt: "The five criteria with Meets, Partly and Not yet",
      },
      {
        title: "Write the overall feedback",
        body: "Under **Overall feedback**, write what the trainee did well and what to work on. Be kind and specific. This can be used in the email the trainee receives.",
        shot: "score-3-feedback",
        alt: "The Overall feedback box",
      },
      {
        title: "Save",
        body: "Your ratings are saved with **Saved** confirming it. You can come back and change them any time before the admins decide. You cannot assess your own record.",
        note: "You do not choose the outcome. Once your assessment is in, an admin decides whether the trainee is certified.",
      },
    ],
  },
];
