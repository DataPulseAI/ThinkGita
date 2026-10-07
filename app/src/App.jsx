import { useEffect, useState } from "react";
import { supabase } from "./lib.js";
import Admin from "./Admin.jsx";
import Facilitator from "./Facilitator.jsx";
import { ThemeToggle, getTheme } from "./ui.jsx";

const LOGO_WHITE = `${import.meta.env.BASE_URL}logo-white.png`;
const LOGO_TEAL = `${import.meta.env.BASE_URL}logo-teal.png`;

export default function App() {
  const [session, setSession] = useState(undefined);
  const [isAdmin, setIsAdmin] = useState(null);
  const [pwOpen, setPwOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return setIsAdmin(null);
    supabase
      .from("admin_emails")
      .select("email")
      .eq("email", session.user.email.toLowerCase())
      .maybeSingle()
      .then(({ data }) => setIsAdmin(Boolean(data)));
  }, [session]);

  if (session === undefined || (session && isAdmin === null)) return <div className="center muted">Loading…</div>;
  if (!session) return <Login />;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img src={LOGO_WHITE} alt="ThinkGita" />
          <span className="product">Circles</span>
          <span className="role">{isAdmin ? "Admin" : "Facilitator"}</span>
        </div>
        <div className="who">
          <span className="email">{session.user.email}</span>
          <ThemeToggle />
          <button className="ghost subtle" onClick={() => setPwOpen(true)}>Change password</button>
          <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      {isAdmin ? <Admin /> : <Facilitator email={session.user.email} />}
      {pwOpen && <PasswordModal onClose={() => setPwOpen(false)} />}
    </div>
  );
}

function Login() {
  const [mode, setMode] = useState("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState({ status: "idle" });

  async function submit(e) {
    e.preventDefault();
    setState({ status: "sending" });
    const address = email.trim().toLowerCase();
    if (mode === "password") {
      const { error } = await supabase.auth.signInWithPassword({ email: address, password });
      if (error) {
        setState({
          status: "error",
          message: /invalid/i.test(error.message)
            ? "Email or password is wrong. If you haven't set a password yet, use an email link once, then choose Change password."
            : error.message,
        });
      }
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.href.split("#")[0] },
    });
    if (error) {
      const notFound = /signup|not allowed|not found/i.test(error.message);
      const limited = /rate limit/i.test(error.message);
      setState({
        status: "error",
        message: notFound
          ? "We don't recognise that email. Use the address you signed up with, or ask the ThinkGita team."
          : limited
            ? "Too many emails sent recently. Try again in a little while, or sign in with your password."
            : error.message,
      });
    } else setState({ status: "sent" });
  }

  return (
    <div className="login">
      <div className="card login-card">
        <img className="login-logo" src={getTheme() === "dark" ? LOGO_WHITE : LOGO_TEAL} alt="ThinkGita" />
        <p className="login-sub">Circles: sign in to manage or view your circle.</p>
        {state.status === "sent" ? (
          <p>Check <b>{email}</b> for a sign-in link. You can close this tab.</p>
        ) : (
          <form onSubmit={submit}>
            <label>Email address</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            {mode === "password" && (
              <>
                <label style={{ marginTop: 10 }}>Password</label>
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </>
            )}
            <button className="primary wide" disabled={state.status === "sending"}>
              {state.status === "sending" ? "Please wait…" : mode === "password" ? "Sign in" : "Email me a sign-in link"}
            </button>
            <button type="button" className="link" style={{ marginTop: 12 }} onClick={() => { setMode(mode === "password" ? "link" : "password"); setState({ status: "idle" }); }}>
              {mode === "password" ? "No password yet? Email me a sign-in link" : "Sign in with a password instead"}
            </button>
            {state.status === "error" && <p className="error">{state.message}</p>}
          </form>
        )}
      </div>
    </div>
  );
}

const PASSWORD_RULES = [
  { label: "At least 8 characters", test: (p) => p.length >= 8 },
  { label: "An uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "A lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "A number", test: (p) => /[0-9]/.test(p) },
];

function PasswordModal({ onClose }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [state, setState] = useState({ status: "idle" });
  const allMet = PASSWORD_RULES.every((r) => r.test(pw));
  const matches = pw.length > 0 && pw === confirm;

  async function save(e) {
    e.preventDefault();
    if (!allMet || !matches) return;
    setState({ status: "saving" });
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (!error) return setState({ status: "done" });
    const msg = /reauth|recent/i.test(error.message)
      ? "For security, sign out and sign back in, then set your password again."
      : /same|different from the old/i.test(error.message)
        ? "That's your current password. Choose a new one."
        : error.message;
    setState({ status: "error", message: msg });
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        {state.status === "done" ? (
          <>
            <h2>Password saved</h2>
            <p className="muted">Next time, sign in with your email and this password.</p>
            <button className="primary wide" onClick={onClose}>Done</button>
          </>
        ) : (
          <form onSubmit={save} className="form">
            <h2>Change password</h2>
            <label>New password
              <input type={show ? "text" : "password"} autoFocus autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </label>
            <ul className="rules">
              {PASSWORD_RULES.map((r) => (
                <li key={r.label} className={r.test(pw) ? "met" : ""}>{r.test(pw) ? "✓" : "○"} {r.label}</li>
              ))}
            </ul>
            <label>Confirm password
              <input type={show ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            {confirm && !matches && <p className="error small">Passwords don't match.</p>}
            <label className="check"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password</label>
            {state.status === "error" && <p className="error small">{state.message}</p>}
            <div className="actions">
              <button type="button" className="ghost" onClick={onClose}>Cancel</button>
              <button className="primary" disabled={!allMet || !matches || state.status === "saving"}>
                {state.status === "saving" ? "Saving…" : "Save password"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
