import { useEffect, useState } from "react";
import { supabase } from "./lib.js";
import Admin from "./Admin.jsx";
import Facilitator from "./Facilitator.jsx";

export default function App() {
  const [session, setSession] = useState(undefined);
  const [isAdmin, setIsAdmin] = useState(null);

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

  async function setPassword() {
    const pw = window.prompt("New password (at least 8 characters)");
    if (!pw) return;
    if (pw.length < 8) return window.alert("Password must be at least 8 characters.");
    const { error } = await supabase.auth.updateUser({ password: pw });
    window.alert(error ? error.message : "Password saved. You can now sign in with email and password.");
  }

  if (session === undefined || (session && isAdmin === null)) return <div className="center muted">Loading…</div>;
  if (!session) return <Login />;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◎</span> ThinkGita Circles
          {isAdmin && <span className="tag">Admin</span>}
        </div>
        <div className="who">
          <span className="muted">{session.user.email}</span>
          <button className="ghost" onClick={setPassword}>Set password</button>
          <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      {isAdmin ? <Admin /> : <Facilitator email={session.user.email} />}
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
            ? "Email or password is wrong. If you haven't set a password yet, use an email link once, then choose Set password."
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
        <div className="brand big"><span className="logo">◎</span> ThinkGita Circles</div>
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
