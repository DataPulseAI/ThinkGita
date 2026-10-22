// Help guides: what each kind of account can see. Content lives in the files below; screenshots in public/help/<shot>.webp.
// A guide's `audience` lists who sees it: "all", "admin" (every admin), "super" (super admins only, shown on top of the
// admin guides), "facilitator" or "assessor". Admins also see the facilitator guides in their Facilitator portal view.
import { gettingStarted } from "./getting-started.js";
import { circleGuides } from "./circles.js";
import { peopleGuides } from "./people.js";
import { zoomGuides } from "./zoom.js";
import { websiteEmailGuides } from "./website-emails.js";
import { trainingGuides } from "./training.js";
import { teamGuides } from "./team.js";
import { facilitatorGuides } from "./facilitator.js";
import { assessorGuides } from "./assessor.js";

export const SECTIONS = [
  "Getting started",
  "Running circles",
  "Facilitators and people",
  "Zoom and attendance",
  "Website and emails",
  "Facilitator training",
  "Team and settings",
  "Your circle",
  "Assessing trainees",
];

export const GUIDES = [
  ...gettingStarted, ...circleGuides, ...peopleGuides, ...zoomGuides, ...websiteEmailGuides,
  ...trainingGuides, ...teamGuides, ...facilitatorGuides, ...assessorGuides,
];

// Guides for someone with these audience keys ("admin", "super", "facilitator", "assessor"), in section order.
export function guidesFor(keys) {
  const mine = GUIDES.filter((g) => g.audience.includes("all") || g.audience.some((a) => keys.includes(a)));
  return SECTIONS.flatMap((s) => mine.filter((g) => g.section === s));
}

export const minutesFor = (g) => Math.max(2, Math.round(g.steps.length * 0.55));

// All the words of a guide, for search.
export const plainText = (g) => g.steps.map((s) => `${s.title} ${s.body} ${s.note ?? ""}`).join(" ").replace(/[*`]/g, "");
