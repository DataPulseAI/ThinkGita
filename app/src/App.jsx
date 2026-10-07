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
  // "setup" when someone arrives from an invite or password-reset email: ask them to choose a password.
  const [pwOpen, setPwOpen] = useState(window.__authLinkType ? "setup" : false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      setSession(s);
      if (e === "PASSWORD_RECOVERY") setPwOpen("setup");
    });
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
      {pwOpen && <PasswordModal setup={pwOpen === "setup"} onClose={() => { window.__authLinkType = null; setPwOpen(false); }} />}
    </div>
  );
}

function Login() {
  const [mode, setMode] = useState("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState({ status: "idle" });
  const switchMode = (m) => { setMode(m); setState({ status: "idle" }); };

  async function submit(e) {
    e.preventDefault();
    setState({ status: "sending" });
    const address = email.trim().toLowerCase();
    if (mode === "reset") {
      const { error } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: window.location.href.split("#")[0] });
      if (error) {
        setState({
          status: "error",
          message: /rate limit/i.test(error.message) ? "Too many emails sent recently. Try again in a little while." : error.message,
        });
      } else setState({ status: "sent" });
      return;
    }
    if (mode === "password") {
      const { error } = await supabase.auth.signInWithPassword({ email: address, password });
      if (error) {
        setState({
          status: "error",
          message: /invalid/i.test(error.message)
            ? "Email or password is wrong. If you haven't set one yet, or have forgotten it, use \"Forgot password\" below."
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
          <p>
            {mode === "reset"
              ? <>If <b>{email}</b> has an account, we've sent a link to choose a new password. You can close this tab.</>
              : <>Check <b>{email}</b> for a sign-in link. You can close this tab.</>}
          </p>
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
              {state.status === "sending" ? "Please wait…" : mode === "password" ? "Sign in" : mode === "reset" ? "Email me a reset link" : "Email me a sign-in link"}
            </button>
            <div className="login-links">
              {mode !== "password" && <button type="button" className="link" onClick={() => switchMode("password")}>Sign in with a password</button>}
              {mode !== "reset" && <button type="button" className="link" onClick={() => switchMode("reset")}>Forgot or never set a password?</button>}
              {mode !== "link" && <button type="button" className="link" onClick={() => switchMode("link")}>Email me a sign-in link</button>}
            </div>
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

function PasswordModal({ onClose, setup = false }) {
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
            <h2>{setup ? "Choose your password" : "Change password"}</h2>
            {setup && <p className="muted small">Welcome to ThinkGita Circles. Choose a password so you can sign in with it next time.</p>}
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
              <button type="button" className="ghost" onClick={onClose}>{setup ? "Later" : "Cancel"}</button>
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
