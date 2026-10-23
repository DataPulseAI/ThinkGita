// Demo build only: a strip at the top saying this is made-up data, with a switch between the people you can be.
import { DEMO_USERS, switchDemoRole } from "./install.js";
import "./demo.css";

export function DemoBar({ role }) {
  return (
    <div className="demo-bar" role="region" aria-label="Demo">
      <span><b>Demo</b> with made-up people. Nothing here is real: no emails, Zoom or website changes. Changes reset when you reload.</span>
      <label className="demo-role">
        View as
        <select value={role.key} onChange={(e) => switchDemoRole(e.target.value)} aria-label="View as">
          {DEMO_USERS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
        </select>
      </label>
    </div>
  );
}
