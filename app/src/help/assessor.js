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
        body: "After you sign in, **Trainees assigned to you** lists everyone you have been asked to assess, with a row of dots showing how far through the seven steps they are. A trainee with every dot filled is **Ready to assess**. Use **To assess** to see the ones still waiting for you, and **Submitted** for the ones you have already sent to the admins.",
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
    title: "Score the five criteria and submit to the admins",
    summary: "Rate each criterion, add notes and overall feedback, save a draft, then submit it with your recommendation. The admins make the final decision.",
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
        title: "Save a draft",
        body: "Click **Save draft** to keep your work. Only you and the admins can see it, and you can come back and change it as often as you like. You cannot assess your own record.",
      },
      {
        title: "Choose your recommendation",
        body: "Under **Your recommendation**, choose **Recommend certifying** or **Not yet**. You need to choose one before you can submit.",
        shot: "score-4-submit",
        alt: "Your recommendation, with Save draft and Submit to admins",
      },
      {
        title: "Submit to the admins",
        body: "When you are happy with it, click **Submit to admins** and confirm. The admins see it straight away on their Training page. After that the assessment is read only for you and shows **Submitted on** with the date. If something needs changing, ask an admin to reopen it.",
        note: "You do not choose the outcome. Your recommendation helps the admins, who decide whether the trainee is certified.",
      },
    ],
  },
];
