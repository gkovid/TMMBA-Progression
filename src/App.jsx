import { useEffect, useMemo, useState } from "react";
import calendarConfig from "./data/calendarConfig.json";
import quarterData from "./data/quarterData.json";

const GOOGLE_CALENDAR_API_KEY =
  import.meta.env.VITE_GOOGLE_CALENDAR_API_KEY || "AIzaSyDC93XY__VQbEUysm_7Qu39HtspvKDnXWQ";
const schedule = quarterData.schedule;
const courseCatalog = quarterData.courses;
const courseDetailsByNumber = Object.fromEntries(
  courseCatalog.map((course) => [course.courseNumber, course])
);
const deadlineFilters = ["All", ...new Set(courseCatalog.map((course) => course.category)), "Other"];

function getCourseFromEvent({ title = "", description = "", location = "" }) {
  const text = [title, description, location].join(" ").toLowerCase();

  const matchedCourse = courseCatalog.find((course) =>
    course.matchKeywords.some((keyword) => text.includes(keyword.toLowerCase()))
  );

  if (matchedCourse) {
    return matchedCourse.category;
  }

  return "Other";
}

function toDateTime(dateStr, timeStr) {
  const [year, month, day] = dateStr.split("-").map(Number);

  const [time, modifier] = timeStr.trim().split(" ");
  let [hours, minutes] = time.split(":").map(Number);

  if (modifier === "PM" && hours !== 12) hours += 12;
  if (modifier === "AM" && hours === 12) hours = 0;

  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function formatDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function getSessionStatus(now, item) {
  const start = toDateTime(item.date, item.start);
  const end = toDateTime(item.date, item.end);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "upcoming";
  }

  if (now < start) return "upcoming";
  if (now > end) return "done";
  return "live";
}

function percent(done, total) {
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

function ProgressBar({ value }) {
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${value}%` }} />
    </div>
  );
}

function StatCard({ title, value, subtitle, progress }) {
  return (
    <div className="card stat-card">
      <div className="card-label">{title}</div>
      <div className="card-value">{value}</div>
      <div className="card-subtitle">{subtitle}</div>
      {typeof progress === "number" && <ProgressBar value={progress} />}
    </div>
  );
}

function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

function formatDeadlineDate(dateString) {
  const d = new Date(dateString);
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: quarterData.timeZone,
  });
}

function getUrgencyLabel(startDateTime) {
  const now = new Date();
  const due = new Date(startDateTime);
  const diffMs = due - now;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffMs < 0) return "Past due";
  if (diffDays < 1) return "Today";
  if (diffDays < 2) return "Tomorrow";
  if (diffDays <= 7) return "This week";
  return "Upcoming";
}

function isPastDue(startDateTime) {
  return new Date(startDateTime) < new Date();
}

function isDueToday(startDateTime) {
  const now = new Date();
  const due = new Date(startDateTime);

  return (
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate()
  );
}

function isDueThisWeek(startDateTime) {
  const now = new Date();
  const due = new Date(startDateTime);

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfWindow = new Date(startOfToday);
  endOfWindow.setDate(endOfWindow.getDate() + 7);

  return due >= startOfToday && due <= endOfWindow;
}

function getCountdownText(startDateTime, now) {
  const due = new Date(startDateTime);
  const diffMs = due - now;

  if (diffMs <= 0) return "Due now or passed";

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `Due in ${days}d ${hours}h`;
  if (hours > 0) return `Due in ${hours}h ${minutes}m`;
  return `Due in ${minutes}m`;
}

export default function App() {
  const [showOnlyUpcoming, setShowOnlyUpcoming] = useState(false);
  const [deadlines, setDeadlines] = useState([]);
  const [deadlinesLoading, setDeadlinesLoading] = useState(true);
  const [deadlinesError, setDeadlinesError] = useState("");
  const [deadlineFilter, setDeadlineFilter] = useState("All");
  const [deadlineQuickFilter, setDeadlineQuickFilter] = useState("all");
  const [now, setNow] = useState(new Date());
  const [completedDeadlines, setCompletedDeadlines] = useState(() => {
    const saved = localStorage.getItem("completedDeadlines");
    return saved ? JSON.parse(saved) : {};
  });

  const sortedSchedule = [...schedule].sort(
    (a, b) => toDateTime(a.date, a.start) - toDateTime(b.date, b.start)
  );

  useEffect(() => {
    async function loadDeadlines() {
      if (
        !GOOGLE_CALENDAR_API_KEY ||
        GOOGLE_CALENDAR_API_KEY === calendarConfig.apiKeyPlaceholder
      ) {
        setDeadlinesLoading(false);
        setDeadlinesError("Add your Google Calendar API key to enable upcoming deadlines.");
        return;
      }

      try {
        setDeadlinesLoading(true);
        setDeadlinesError("");

        const timeMin = new Date(calendarConfig.queryWindow.start).toISOString();
        const timeMax = new Date(calendarConfig.queryWindow.end).toISOString();
        const allItems = [];
        let nextPageToken = "";

        do {
          const params = new URLSearchParams({
            key: GOOGLE_CALENDAR_API_KEY,
            singleEvents: "true",
            orderBy: "startTime",
            timeMin,
            timeMax,
            maxResults: String(calendarConfig.maxResults || 50),
          });

          if (nextPageToken) {
            params.set("pageToken", nextPageToken);
          }

          const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
            calendarConfig.calendarId
          )}/events?${params.toString()}`;

          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(`Calendar API error: ${res.status}`);
          }

          const data = await res.json();
          allItems.push(...(data.items || []));
          nextPageToken = data.nextPageToken || "";
        } while (nextPageToken);

        const items = allItems
          .filter((item) => item.start?.dateTime || item.start?.date)
          .map((item) => {
            const start = item.start.dateTime || `${item.start.date}T23:59:00`;
            const title = item.summary || "Untitled assignment";
            const description = item.description || "";
            const location = item.location || "";

            return {
              id: item.id,
              title,
              start,
              location,
              description,
              link: item.htmlLink || "",
              courseCategory: getCourseFromEvent({
                title,
                description,
                location,
              }),
            };
          })
          .sort((a, b) => new Date(a.start) - new Date(b.start));

        setDeadlines(items);
      } catch (err) {
        setDeadlinesError("Couldn’t load upcoming deadlines.");
        console.error(err);
      } finally {
        setDeadlinesLoading(false);
      }
    }

    loadDeadlines();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    localStorage.setItem("completedDeadlines", JSON.stringify(completedDeadlines));
  }, [completedDeadlines]);

  function toggleDeadlineDone(id) {
    setCompletedDeadlines((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }

  function toggleDeadlineQuickFilter(nextFilter) {
    setDeadlineQuickFilter((prev) => (prev === nextFilter ? "all" : nextFilter));
  }

  const overall = useMemo(() => {
    const total = sortedSchedule.length;
    const done = sortedSchedule.filter((item) => getSessionStatus(now, item) === "done").length;
    const live = sortedSchedule.filter((item) => getSessionStatus(now, item) === "live").length;
    const next = sortedSchedule.find((item) => getSessionStatus(now, item) === "upcoming") || null;

    const start = toDateTime(sortedSchedule[0].date, sortedSchedule[0].start);
    const end = toDateTime(
      sortedSchedule[sortedSchedule.length - 1].date,
      sortedSchedule[sortedSchedule.length - 1].end
    );

    let calendarProgress = 0;

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      calendarProgress = 0;
    } else if (now <= start) {
      calendarProgress = 0;
    } else if (now >= end) {
      calendarProgress = 100;
    } else {
      calendarProgress = Math.round(((now - start) / (end - start)) * 100);
    }

    return {
      total,
      done,
      live,
      next,
      calendarProgress,
    };
  }, [now, sortedSchedule]);

  const filteredDeadlines = useMemo(() => {
    const visible =
      deadlineFilter === "All"
        ? deadlines
        : deadlines.filter((item) => item.courseCategory === deadlineFilter);

    return visible;
  }, [deadlines, deadlineFilter]);

  const activeFilteredDeadlines = useMemo(() => {
    return filteredDeadlines.filter((item) => !completedDeadlines[item.id]);
  }, [filteredDeadlines, completedDeadlines]);

  const completedFilteredDeadlines = useMemo(() => {
    return filteredDeadlines.filter((item) => completedDeadlines[item.id]);
  }, [filteredDeadlines, completedDeadlines]);

  const filteredDeadlineSummary = useMemo(() => {
    const upcoming = activeFilteredDeadlines.filter((item) => !isPastDue(item.start));
    const nextDeadline = upcoming.length > 0 ? upcoming[0] : null;

    const dueTodayCount = upcoming.filter((item) => isDueToday(item.start)).length;
    const dueThisWeekCount = upcoming.filter((item) => isDueThisWeek(item.start)).length;
    const completedCount = completedFilteredDeadlines.length;

    return {
      nextDeadline,
      dueTodayCount,
      dueThisWeekCount,
      completedCount,
    };
  }, [activeFilteredDeadlines, completedFilteredDeadlines]);

  const visibleActiveDeadlines = useMemo(() => {
    if (deadlineQuickFilter === "today") {
      return activeFilteredDeadlines.filter((item) => isDueToday(item.start));
    }

    if (deadlineQuickFilter === "week") {
      return activeFilteredDeadlines.filter((item) => isDueThisWeek(item.start));
    }

    if (deadlineQuickFilter === "completed") {
      return [];
    }

    return activeFilteredDeadlines;
  }, [activeFilteredDeadlines, deadlineQuickFilter]);

  const visibleCompletedDeadlines = useMemo(() => {
    if (deadlineQuickFilter === "completed") {
      return completedFilteredDeadlines;
    }

    return completedFilteredDeadlines;
  }, [completedFilteredDeadlines, deadlineQuickFilter]);

  const displayedNextDeadline = useMemo(() => {
    if (deadlineQuickFilter === "completed") {
      return null;
    }

    return visibleActiveDeadlines.find((item) => !isPastDue(item.start)) || null;
  }, [deadlineQuickFilter, visibleActiveDeadlines]);

  const deadlineEmptyMessage =
    deadlineQuickFilter === "today"
      ? "No assignments due today for this filter."
      : deadlineQuickFilter === "week"
        ? "No assignments due this week for this filter."
        : deadlineQuickFilter === "completed"
          ? "No completed assignments for this filter."
          : "No upcoming deadlines found.";

  const courses = useMemo(() => {
    const grouped = {};

    sortedSchedule.forEach((item) => {
      const courseDetails = courseDetailsByNumber[item.courseNumber];

      if (!grouped[item.courseNumber]) {
        grouped[item.courseNumber] = {
          courseNumber: item.courseNumber,
          course: courseDetails?.course || item.course,
          instructor: courseDetails?.instructor || item.instructor,
          credits: courseDetails?.credits || 0,
          sessions: [],
        };
      }
      grouped[item.courseNumber].sessions.push(item);
    });

    return Object.values(grouped).map((group) => {
      const done = group.sessions.filter((item) => getSessionStatus(now, item) === "done").length;
      const next =
        group.sessions.find((item) => getSessionStatus(now, item) === "upcoming") || null;

      return {
        ...group,
        done,
        total: group.sessions.length,
        next,
      };
    });
  }, [now, sortedSchedule]);

  const visibleSchedule = showOnlyUpcoming
    ? sortedSchedule.filter((item) => getSessionStatus(now, item) !== "done")
    : sortedSchedule;

  return (
    <div className="app-shell">
      <div className="app-container">
        <header className="hero">
          <div>
            <p className="eyebrow">{quarterData.programLabel}</p>
            <h1>{quarterData.quarterTitle}</h1>
            <p className="hero-subtitle">{quarterData.heroSubtitle}</p>
          </div>
        </header>
        <div
          className={`banner ${filteredDeadlineSummary.dueTodayCount > 0
            ? "banner-warning"
            : filteredDeadlineSummary.completedCount > 0
              ? "banner-neutral"
              : "banner-neutral"
            }`}
        >
          {filteredDeadlineSummary.dueTodayCount > 0
            ? `⚠️ You have ${filteredDeadlineSummary.dueTodayCount} assignment(s) due today`
            : filteredDeadlineSummary.completedCount > 0
              ? `✅ You’ve completed ${filteredDeadlineSummary.completedCount} assignment(s) on this device`
              : "✅ No assignments due today"}
        </div>
        <section className="stats-grid">
          <StatCard
            title="Quarter Progress"
            value={`${percent(overall.done, overall.total)}%`}
            subtitle={`${overall.done} of ${overall.total} class meetings completed`}
            progress={percent(overall.done, overall.total)}
          />
          <StatCard
            title="Calendar Progress"
            value={`${overall.calendarProgress}%`}
            subtitle="Progress through the overall quarter timeline"
            progress={overall.calendarProgress}
          />
          <StatCard
            title="Live Status"
            value={overall.live > 0 ? "In class" : "Not in class"}
            subtitle={`${overall.live} session live right now`}
          />
          <div className="card stat-card">
            <div className="card-label">Next Class</div>
            {overall.next ? (
              <>
                <div className="card-value next-class-number">{overall.next.courseNumber}</div>
                <div className="card-subtitle strong">
                  {formatDate(overall.next.date)} · {overall.next.start}–{overall.next.end}
                </div>
                <div className="card-subtitle">{overall.next.course}</div>
              </>
            ) : (
              <>
                <div className="card-value">Done</div>
                <div className="card-subtitle">Quarter complete</div>
              </>
            )}
          </div>
        </section>

        <section>
          <div className="section-header">
            <h2>Course Progress</h2>
          </div>

          <div className="course-grid">
            {courses.map((course) => (
              <div className="card course-card" key={course.courseNumber}>
                <div className="course-topline">
                  <div>
                    <div className="course-number">{course.courseNumber}</div>
                    <div className="course-name">{course.course}</div>
                  </div>
                  <span className="pill">{course.credits} credits</span>
                </div>

                <div className="course-meta">
                  <span>{course.done} / {course.total} sessions done</span>
                  <span>{percent(course.done, course.total)}%</span>
                </div>

                <ProgressBar value={percent(course.done, course.total)} />

                <div className="course-footer">
                  <div>Instructor: {course.instructor}</div>
                  <div>
                    Next:{" "}
                    {course.next
                      ? `${formatDate(course.next.date)} at ${course.next.start}`
                      : "Complete"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="section-header timeline-header">
            <div>
              <h2>Schedule Timeline</h2>
              <p className="section-subtitle">See everything, or just what’s left.</p>
            </div>

            <button
              className="toggle-button"
              onClick={() => setShowOnlyUpcoming((prev) => !prev)}
            >
              {showOnlyUpcoming ? "Show all" : "Show only upcoming"}
            </button>
          </div>

          <div className="timeline-list">
            {visibleSchedule.map((item, index) => {
              const status = getSessionStatus(now, item);

              return (
                <div className="card timeline-item" key={`${item.courseNumber}-${item.date}-${index}`}>
                  <div className="timeline-left">
                    <div className="timeline-top">
                      <StatusBadge status={status} />
                      <span className="timeline-course-number">{item.courseNumber}</span>
                    </div>
                    <div className="timeline-title">{item.course}</div>
                    <div className="timeline-subtitle">
                      {formatDate(item.date)} · {item.start}–{item.end}
                    </div>
                  </div>

                  <div className="timeline-right">
                    <div>{item.location}</div>
                    <div>{item.instructor}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <section>
          <div className="section-header">
            <h2>Upcoming Deadlines</h2>
            <p className="section-subtitle">
              Your next assignments from the Google Calendar feed.
            </p>
          </div>

          <div className="deadline-filter-row">
            {deadlineFilters.map((filter) => (
              <button
                key={filter}
                className={`filter-chip ${deadlineFilter === filter ? "filter-chip-active" : ""}`}
                onClick={() => setDeadlineFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>

          {deadlinesLoading ? (
            <div className="card deadlines-empty">Loading deadlines...</div>
          ) : deadlinesError ? (
            <div className="card deadlines-empty">{deadlinesError}</div>
          ) : visibleActiveDeadlines.length === 0 && visibleCompletedDeadlines.length === 0 ? (
            <div className="card deadlines-empty">{deadlineEmptyMessage}</div>
          ) : (
            <>
              <div className="deadline-summary-grid">
                <div className="card next-deadline-card">
                  <div className="card-label">Next Deadline</div>

                  {displayedNextDeadline ? (
                    <>
                      <div className="next-deadline-title">{displayedNextDeadline.title}</div>
                      <div className="next-deadline-date">
                        {formatDeadlineDate(displayedNextDeadline.start)}
                      </div>
                      <div className="next-deadline-countdown">
                        {getCountdownText(displayedNextDeadline.start, now)}
                      </div>

                      <div className="next-deadline-badges">
                        <span
                          className={`pill urgency-${getUrgencyLabel(displayedNextDeadline.start)
                            .toLowerCase()
                            .replace(" ", "-")}`}
                        >
                          {getUrgencyLabel(displayedNextDeadline.start)}
                        </span>
                      </div>

                      {displayedNextDeadline.link ? (
                        <a
                          className="deadline-link"
                          href={displayedNextDeadline.link}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open in Google Calendar
                        </a>
                      ) : null}
                    </>
                  ) : (
                    <div className="card-subtitle">No upcoming deadlines</div>
                  )}
                </div>

                <div className="deadline-mini-stats">
                  <button
                    type="button"
                    className={`card mini-stat-card ${deadlineQuickFilter === "today" ? "mini-stat-card-active" : ""}`}
                    onClick={() => toggleDeadlineQuickFilter("today")}
                    aria-pressed={deadlineQuickFilter === "today"}
                  >
                    <div className="card-label">Due Today</div>
                    <div className="card-value">{filteredDeadlineSummary.dueTodayCount}</div>
                  </button>

                  <button
                    type="button"
                    className={`card mini-stat-card ${deadlineQuickFilter === "week" ? "mini-stat-card-active" : ""}`}
                    onClick={() => toggleDeadlineQuickFilter("week")}
                    aria-pressed={deadlineQuickFilter === "week"}
                  >
                    <div className="card-label">Due This Week</div>
                    <div className="card-value">{filteredDeadlineSummary.dueThisWeekCount}</div>
                  </button>

                  <button
                    type="button"
                    className={`card mini-stat-card ${deadlineQuickFilter === "completed" ? "mini-stat-card-active" : ""}`}
                    onClick={() => toggleDeadlineQuickFilter("completed")}
                    aria-pressed={deadlineQuickFilter === "completed"}
                  >
                    <div className="card-label">Completed</div>
                    <div className="card-value">{filteredDeadlineSummary.completedCount}</div>
                  </button>
                </div>
              </div>

              <div className="deadlines-grid">
                {visibleActiveDeadlines.map((item) => (
                  <div
                    className={`card deadline-card ${getUrgencyLabel(item.start) === "Past due"
                      ? "urgency-past-due-card"
                      : getUrgencyLabel(item.start) === "Today"
                        ? "urgency-today-card"
                        : getUrgencyLabel(item.start) === "This week"
                          ? "urgency-this-week-card"
                          : ""
                      }`}
                    key={item.id}
                  >
                    <div className="deadline-topline">
                      <span
                        className={`pill urgency-${getUrgencyLabel(item.start)
                          .toLowerCase()
                          .replace(" ", "-")}`}
                      >
                        {getUrgencyLabel(item.start)}
                      </span>
                    </div>

                    <div className="deadline-title">{item.title}</div>
                    <div className="deadline-date">{formatDeadlineDate(item.start)}</div>
                    <div className="deadline-countdown">{getCountdownText(item.start, now)}</div>

                    {item.location ? (
                      <div className="deadline-meta">{item.location}</div>
                    ) : null}

                    <div className="deadline-actions">
                      <button
                        className="done-button"
                        onClick={() => toggleDeadlineDone(item.id)}
                      >
                        Mark done
                      </button>

                      {item.link ? (
                        <a
                          className="deadline-link"
                          href={item.link}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open in Google Calendar
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              {visibleCompletedDeadlines.length > 0 && (
                <>
                  <div className="section-header">
                    <h2>Completed</h2>
                    <p className="section-subtitle">
                      Assignments you’ve marked as done on this device.
                    </p>
                  </div>

                  <div className="deadlines-grid">
                    {visibleCompletedDeadlines.map((item) => (
                      <div className="card deadline-card deadline-card-completed" key={item.id}>
                        <div className="deadline-topline">
                          <span className="pill">Done</span>
                        </div>

                        <div className="deadline-title">{item.title}</div>
                        <div className="deadline-date">{formatDeadlineDate(item.start)}</div>

                        <div className="deadline-actions">
                          <button
                            className="done-button done-button-secondary"
                            onClick={() => toggleDeadlineDone(item.id)}
                          >
                            Undo
                          </button>

                          {item.link ? (
                            <a
                              className="deadline-link"
                              href={item.link}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open in Google Calendar
                            </a>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </section>
        <section>
          <div className="section-header">
            <h2>Assignment Deadlines</h2>
            <p className="section-subtitle">
              Live view from your Google Calendar.
            </p>
          </div>

          <div className="card calendar-card">
            <iframe
              title="Assignment Deadlines Calendar"
              src={calendarConfig.embedUrl}
              style={{ border: 0, width: "100%", height: "700px", borderRadius: "24px" }}
              frameBorder="0"
              scrolling="no"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
