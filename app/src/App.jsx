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
          <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      {isAdmin ? <Admin /> : <Facilitator email={session.user.email} />}
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState({ status: "idle" });

  async function send(e) {
    e.preventDefault();
    setState({ status: "sending" });
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false, emailRedirectTo: window.location.href.split("#")[0] },
    });
    if (error) {
      const notFound = /signup|not allowed|not found/i.test(error.message);
      setState({
        status: "error",
        message: notFound
          ? "We don't recognise that email. Use the address you signed up with, or ask the ThinkGita team."
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
          <form onSubmit={send}>
            <label>Email address</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            <button className="primary wide" disabled={state.status === "sending"}>
              {state.status === "sending" ? "Sending…" : "Email me a sign-in link"}
            </button>
            {state.status === "error" && <p className="error">{state.message}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
