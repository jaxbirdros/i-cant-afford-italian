const { useState, useEffect, useMemo } = React;

const SUPABASE_URL = "https://your-supabase-url.supabase.co";
const SUPABASE_ANON_KEY = "your-anon-key";
const PAYPAL_ME_BASE = "https://paypal.me/yourname";
const VOTE_STORAGE_KEY = "icantafforditalian-vote";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function formatMoney(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, value));
}

function buildPaypalLink(amount) {
  if (!amount || Number(amount) <= 0) {
    return PAYPAL_ME_BASE;
  }
  return `${PAYPAL_ME_BASE}/${Number(amount)}`;
}

function useSupabaseAuth() {
  const [user, setUser] = useState(null);
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => {
    async function init() {
      const { data } = await supabaseClient.auth.getSession();
      setUser(data.session?.user || null);
    }

    init();

    const { data: listener } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => listener?.subscription.unsubscribe();
  }, []);

  const sendMagicLink = async (email) => {
    if (!email) return;
    await supabaseClient.auth.signInWithOtp({ email });
    setEmailSent(true);
  };

  const signOut = async () => {
    await supabaseClient.auth.signOut();
    setUser(null);
  };

  return { user, emailSent, sendMagicLink, signOut };
}

function App() {
  const { user, emailSent, sendMagicLink, signOut } = useSupabaseAuth();
  const [email, setEmail] = useState("");
  const [events, setEvents] = useState([]);
  const [votes, setVotes] = useState([]);
  const [selectedDateId, setSelectedDateId] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formState, setFormState] = useState({
    id: null,
    name: "",
    date: "",
    location: "",
    cost: "",
    funded: "",
    details: "",
  });
  const [newVoteIdea, setNewVoteIdea] = useState("");
  const [customAmount, setCustomAmount] = useState(25);
  const [hasVoted, setHasVoted] = useState(false);
  const [activeMonth, setActiveMonth] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  const storedVote = localStorage.getItem(VOTE_STORAGE_KEY);

  useEffect(() => {
    if (storedVote) {
      setHasVoted(true);
    }
  }, [storedVote]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [{ data: datesData, error: datesError }, { data: voteData, error: voteError }] = await Promise.all([
        supabaseClient.from("dates").select("*").order("date", { ascending: true }),
        supabaseClient.from("vote_options").select("*").order("votes", { ascending: false }),
      ]);

      if (datesError || voteError) {
        setErrorText("Could not load saved dates yet. Preview mode is still ready.");
      }

      setEvents(datesData?.map((item) => ({ ...item, cost: Number(item.cost), funded: Number(item.funded) })) || sampleEvents);
      setVotes(voteData || sampleVotes);
    } catch (err) {
      setErrorText("Network issue fetching plan data.");
      setEvents(sampleEvents);
      setVotes(sampleVotes);
    }
    setLoading(false);
  }

  const totalNeeded = useMemo(() => events.reduce((sum, item) => sum + item.cost, 0), [events]);
  const totalRaised = useMemo(() => events.reduce((sum, item) => sum + item.funded, 0), [events]);
  const overallProgress = totalNeeded ? Math.round((totalRaised / totalNeeded) * 100) : 0;

  const calendarCells = useMemo(() => {
    const month = new Date(activeMonth.getFullYear(), activeMonth.getMonth(), 1);
    const firstDay = month.getDay();
    const daysInMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push(new Date(activeMonth.getFullYear(), activeMonth.getMonth(), day));
    }
    return cells;
  }, [activeMonth]);

  useEffect(() => {
    const event = events.find((item) => item.id === selectedDateId);
    setSelectedEvent(event || null);
  }, [selectedDateId, events]);

  const handleDateSelect = (date) => {
    const found = events.find((item) => item.date === date.toISOString().slice(0, 10));
    setSelectedDateId(found?.id || null);
  };

  const handleVote = async (id) => {
    if (hasVoted || storedVote) return;
    const newVotes = votes.map((item) => {
      if (item.id === id) return { ...item, votes: item.votes + 1 };
      return item;
    });
    setVotes(newVotes);
    localStorage.setItem(VOTE_STORAGE_KEY, String(id));
    setHasVoted(true);
    await supabaseClient.from("vote_options").update({ votes: supabaseClient.raw("votes + 1") }).eq("id", id);
  };

  const handleSaveDate = async (event) => {
    event.preventDefault();
    const payload = {
      name: formState.name,
      date: formState.date,
      location: formState.location,
      details: formState.details,
      cost: Number(formState.cost),
      funded: Number(formState.funded),
    };

    try {
      if (formState.id) {
        await supabaseClient.from("dates").update(payload).eq("id", formState.id);
        setEvents((prev) => prev.map((item) => (item.id === formState.id ? { ...item, ...payload } : item)));
      } else {
        const { data, error } = await supabaseClient.from("dates").insert(payload).select().single();
        if (!error && data) {
          setEvents((prev) => [...prev, { ...data, cost: Number(data.cost), funded: Number(data.funded) }]);
        }
      }
      setShowForm(false);
      setFormState({ id: null, name: "", date: "", location: "", cost: "", funded: "", details: "" });
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteDate = async (id) => {
    if (!window.confirm("Delete this date plan?")) return;
    await supabaseClient.from("dates").delete().eq("id", id);
    setEvents((prev) => prev.filter((item) => item.id !== id));
    setSelectedDateId(null);
    setSelectedEvent(null);
  };

  const handleEditDate = (item) => {
    setFormState({
      id: item.id,
      name: item.name,
      date: item.date,
      location: item.location,
      cost: item.cost,
      funded: item.funded,
      details: item.details,
    });
    setShowForm(true);
  };

  const handleAddVoteIdea = async () => {
    if (!newVoteIdea.trim()) return;
    const payload = { idea: newVoteIdea.trim(), votes: 0 };
    const { data, error } = await supabaseClient.from("vote_options").insert(payload).select().single();
    if (!error && data) {
      setVotes((prev) => [...prev, data]);
      setNewVoteIdea("");
    }
  };

  const handleRemoveVoteIdea = async (id) => {
    if (!window.confirm("Remove this idea?")) return;
    await supabaseClient.from("vote_options").delete().eq("id", id);
    setVotes((prev) => prev.filter((item) => item.id !== id));
  };

  const voteTotal = votes.reduce((sum, item) => sum + item.votes, 0);

  const pageNotes = loading ? "Loading saved planning data..." : errorText;

  return (
    <div className="page-shell">
      <div className="panel topbar">
        <div className="brand">
          <h1>i-cant-afford-italian</h1>
          <p>A simple page for people who want great dates but not the bill. See the plans, help fund them, and keep the next idea crowd-approved.</p>
        </div>
        <div style={{ display: "grid", gap: "10px", justifyItems: "end" }}>
          {user ? (
            <button className="secondary-button small-button" onClick={signOut}>
              Owner signed in
            </button>
          ) : (
            <button className="secondary-button" onClick={() => document.getElementById("owner-login").scrollIntoView({ behavior: "smooth" })}>
              Owner login
            </button>
          )}
          <button className="primary-button" onClick={() => document.getElementById("funding").scrollIntoView({ behavior: "smooth" })}>
            Fund a date
          </button>
        </div>
      </div>

      <section className="panel" id="funding">
        <div className="section-title">
          <h2>Make a real date happen</h2>
          <span className="footer-note">Your support turns the plan from wish list into a booked evening.</span>
        </div>
        <div className="status-card">
          <div className="metric-row">
            <div className="metric-box">
              <span>Raised so far</span>
              <strong>{formatMoney(totalRaised)}</strong>
            </div>
            <div className="metric-box">
              <span>Needed for upcoming plans</span>
              <strong>{formatMoney(totalNeeded)}</strong>
            </div>
          </div>
          <div className="progress-row">
            <div className="progress-label">
              <span>Overall funding</span>
              <strong>{overallProgress}%</strong>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${clampPercent(overallProgress)}%` }} />
            </div>
          </div>
          <div className="footer-note">Every gift moves one date from hopeful to booked. 5 buys a snack, 20 covers a dessert, 50 keeps a night on the calendar.</div>
        </div>

        <div className="contribution-panel">
          <div className="suggested-gifts">
            {[5, 10, 20, 35].map((amount) => (
              <a key={amount} href={buildPaypalLink(amount)} className="small-button" target="_blank" rel="noreferrer">
                Give {formatMoney(amount)}
              </a>
            ))}
          </div>
          <div className="amount-entry">
            <label>
              Pick another amount
              <input type="number" min="1" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} />
            </label>
            <a href={buildPaypalLink(customAmount)} className="primary-button" target="_blank" rel="noreferrer">
              Donate {customAmount ? formatMoney(customAmount) : "now"}
            </a>
          </div>
        </div>

        <div className="footer-note">This only works because people chip in together. If you care about keeping these date plans alive, this is the page that does it.</div>
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>Next dates on the calendar</h2>
          <span className="footer-note">Tap a day to see what the plan is and how much is already covered.</span>
        </div>
        <div className="calendar-grid">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
            <div key={label} className="calendar-cell inactive" style={{ fontWeight: 700, textAlign: "center" }}>
              {label}
            </div>
          ))}
          {calendarCells.map((date, index) => {
            if (!date) return <div key={`empty-${index}`} className="calendar-cell inactive" />;
            const dateKey = date.toISOString().slice(0, 10);
            const dayEvents = events.filter((item) => item.date === dateKey);
            return (
              <button key={dateKey} className={`calendar-cell ${dayEvents.length === 0 ? "inactive" : ""}`} onClick={() => handleDateSelect(date)}>
                <div className="day-number">{date.getDate()}</div>
                {dayEvents.slice(0, 2).map((item) => (
                  <div key={item.id} className="event-pill">
                    {item.name} • {formatMoney(item.cost)}
                  </div>
                ))}
              </button>
            );
          })}
        </div>

        <div className="event-detail" style={{ marginTop: "22px" }}>
          {selectedEvent ? (
            <div className="status-card">
              <div style={{ display: "grid", gap: "10px" }}>
                <strong>{selectedEvent.name}</strong>
                <div>{selectedEvent.date} · {selectedEvent.location}</div>
              </div>
              <div>{selectedEvent.details}</div>
              <div className="metric-row">
                <div className="metric-box">
                  <span>Cost</span>
                  <strong>{formatMoney(selectedEvent.cost)}</strong>
                </div>
                <div className="metric-box">
                  <span>Funded</span>
                  <strong>{formatMoney(selectedEvent.funded)}</strong>
                </div>
              </div>
              <div className="progress-row">
                <div className="progress-label">
                  <span>Progress for this plan</span>
                  <strong>{clampPercent(Math.round((selectedEvent.funded / selectedEvent.cost) * 100))}%</strong>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${clampPercent(Math.round((selectedEvent.funded / selectedEvent.cost) * 100))}%` }} />
                </div>
              </div>
              <div className="event-actions">
                <a href={buildPaypalLink(20)} className="small-button" target="_blank" rel="noreferrer">
                  Add support
                </a>
                {user && (
                  <>
                    <button className="secondary-button" onClick={() => handleEditDate(selectedEvent)}>
                      Edit plan
                    </button>
                    <button className="secondary-button" onClick={() => handleDeleteDate(selectedEvent.id)}>
                      Remove plan
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="status-card">
              <p>Select a calendar day to review the plan and update the details.</p>
            </div>
          )}
        </div>

        {user && (
          <div className="event-actions" style={{ marginTop: "14px" }}>
            <button className="primary-button" onClick={() => setShowForm(true)}>
              Add a date plan
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>Vote on the next idea</h2>
          <span className="footer-note">One vote per session keeps the choice simple and fair.</span>
        </div>

        <div className="vote-card">
          {votes.map((option) => {
            const percentage = voteTotal ? Math.round((option.votes / voteTotal) * 100) : 0;
            return (
              <div key={option.id} className="vote-option">
                <header>
                  <div>
                    <strong>{option.idea}</strong>
                    <div className="footer-note">{option.votes} vote{option.votes === 1 ? "" : "s"}</div>
                  </div>
                  {!hasVoted && (
                    <button className="small-button" onClick={() => handleVote(option.id)}>
                      Vote
                    </button>
                  )}
                </header>
                <div className="vote-bar-track">
                  <div className="vote-bar-fill" style={{ width: `${percentage}%` }} />
                </div>
                <div className="footer-note">{percentage}% of session votes</div>
                {user && (
                  <button className="secondary-button" onClick={() => handleRemoveVoteIdea(option.id)}>
                    Remove idea
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {user && (
          <div className="form-row" style={{ marginTop: "18px" }}>
            <label>
              Add a new idea
              <input value={newVoteIdea} onChange={(e) => setNewVoteIdea(e.target.value)} placeholder="Rooftop dinner, arcade night, picnic..." />
            </label>
            <button className="primary-button" onClick={handleAddVoteIdea}>
              Add idea
            </button>
          </div>
        )}
      </section>

      <section className="panel" id="owner-login">
        <div className="section-title">
          <h2>Owner login</h2>
          <span className="footer-note">Sign in with a magic link to manage plans and vote options.</span>
        </div>
        <div className="form-row">
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com" />
          </label>
          <button className="primary-button" onClick={() => sendMagicLink(email)}>
            Send magic link
          </button>
        </div>
        {emailSent && <div className="footer-note">Check your inbox for a link. It may take a moment.</div>}
      </section>

      {showForm && (
        <section className="panel">
          <div className="section-title">
            <h2>{formState.id ? "Edit date plan" : "New date plan"}</h2>
          </div>
          <form className="form-row" onSubmit={handleSaveDate}>
            <label>
              Name
              <input value={formState.name} onChange={(e) => setFormState({ ...formState, name: e.target.value })} required />
            </label>
            <label>
              Date
              <input type="date" value={formState.date} onChange={(e) => setFormState({ ...formState, date: e.target.value })} required />
            </label>
            <label>
              Location
              <input value={formState.location} onChange={(e) => setFormState({ ...formState, location: e.target.value })} required />
            </label>
            <label>
              Cost
              <input type="number" min="0" value={formState.cost} onChange={(e) => setFormState({ ...formState, cost: e.target.value })} required />
            </label>
            <label>
              Funded so far
              <input type="number" min="0" value={formState.funded} onChange={(e) => setFormState({ ...formState, funded: e.target.value })} />
            </label>
            <label>
              Notes
              <textarea rows="4" value={formState.details} onChange={(e) => setFormState({ ...formState, details: e.target.value })} />
            </label>
            <div className="event-actions">
              <button className="primary-button" type="submit">
                Save
              </button>
              <button type="button" className="secondary-button" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="footer-note">Built for friends who want to keep the date list real. Customize the Supabase URL and PayPal.me link to make it yours.</div>
      <div className="footer-note">{pageNotes}</div>
    </div>
  );
}

const sampleEvents = [
  {
    id: 1,
    name: "Rooftop dinner",
    date: new Date(new Date().setDate(new Date().getDate() + 4)).toISOString().slice(0, 10),
    location: "Neighborhood rooftop",
    cost: 140,
    funded: 60,
    details: "A warm night, good view, and a meal that deserves to be shared.",
  },
  {
    id: 2,
    name: "Arcade + late coffee",
    date: new Date(new Date().setDate(new Date().getDate() + 11)).toISOString().slice(0, 10),
    location: "Old arcade downtown",
    cost: 95,
    funded: 20,
    details: "Few quarters, more laughter, and a coffee afterward to recover.",
  },
  {
    id: 3,
    name: "Picnic in the park",
    date: new Date(new Date().setDate(new Date().getDate() + 18)).toISOString().slice(0, 10),
    location: "City park shelter",
    cost: 55,
    funded: 15,
    details: "A quiet afternoon with a homemade spread and time to relax.",
  },
];

const sampleVotes = [
  { id: 11, idea: "Rooftop dinner", votes: 6 },
  { id: 12, idea: "Arcade night", votes: 5 },
  { id: 13, idea: "Hiking then coffee", votes: 3 },
  { id: 14, idea: "Home cooked meal", votes: 4 },
];

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
