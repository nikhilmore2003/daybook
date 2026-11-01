// Supabase Edge Function: daily-questions
// Makes ONE set of practice questions per day (India time), shared by every Daybook user,
// using Google's Gemini API. The first visit of the day (or the nightly schedule) creates it.
//
// Deploy: Supabase → Edge Functions → Deploy a new function → Via Editor → name it "daily-questions",
// paste this file, Deploy. Then add the secret GEMINI_API_KEY (Edge Functions → Secrets).
// Optional secret GEMINI_MODEL to pick a specific model ID from Google AI Studio.

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const LEVELS: Record<string, number> = { easy: 2, medium: 3, hard: 2 };

const SUBJECTS = [
  {
    name: "Excel",
    topics: "formulas, XLOOKUP / VLOOKUP / INDEX-MATCH, IF / IFS / nested logic, SUMIFS / COUNTIFS, text and date functions, pivot tables, conditional formatting, data cleaning, Power Query, charts and dashboards",
    context: "Describe the sheet: column letters, headers and 4 to 6 sample rows as a small table.",
  },
  {
    name: "SQL",
    topics: "filtering and sorting, aggregations and GROUP BY / HAVING, joins, subqueries, CTEs, window functions (ROW_NUMBER, RANK, LAG/LEAD, running totals), CASE WHEN, date functions, de-duplication",
    context: "Give the table schema(s) with column names and types and 4 to 6 sample rows. Use standard SQL that works in MySQL 8 and PostgreSQL.",
  },
  {
    name: "Python",
    topics: "Pandas (filtering, groupby, merge, pivot_table, apply, datetime), NumPy, data cleaning (nulls, duplicates, types), string methods, core Python for data (lists, dicts, functions, loops), basic Matplotlib/Seaborn",
    context: "Give the DataFrame columns and a few sample rows, or short code that builds it.",
  },
  {
    name: "Power BI",
    topics: "DAX measures, CALCULATE and filter context, time intelligence (YTD, MoM, same period last year), calculated columns vs measures, data modeling and relationships (star schema), Power Query transformations, visual and report design, row-level security",
    context: "Describe the tables in the model with key columns and relationships.",
  },
  {
    name: "Business case",
    topics: "KPIs and metric definitions, root cause analysis of a metric drop, guesstimates, A/B testing, funnel and cohort analysis, retention, pricing, e-commerce / quick-commerce / fintech / food delivery scenarios in India",
    context: "Give a concrete business scenario with numbers where useful. Answers are structured approaches, not code.",
  },
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Calendar day in India (UTC+5:30), shifted by n days.
const istDay = (n = 0) => new Date(Date.now() + 5.5 * 3600e3 + n * 864e5).toISOString().slice(0, 10);

function buildPrompt(s: typeof SUBJECTS[number], recent: string[]) {
  const total = LEVELS.easy + LEVELS.medium + LEVELS.hard;
  return `You write daily interview-practice questions for aspiring data analysts in India.
Subject: ${s.name}
Write exactly ${LEVELS.easy} easy, ${LEVELS.medium} medium and ${LEVELS.hard} hard questions (${total} total), in that order.
Spread them across different topics from: ${s.topics}.
Every question must be self-contained and solvable from its text alone. ${s.context}
Easy = one concept. Medium = combines 2 or 3 concepts. Hard = multi-step, realistic interview level.
Put tables and code inside triple-backtick blocks. Keep each question under 180 words.
For every question also write a correct model answer (formula, query, code or structured approach) followed by a 1 to 3 sentence explanation.
${recent.length ? `Do NOT repeat or closely paraphrase any of these recent questions:\n- ${recent.join("\n- ")}\n` : ""}
Respond with JSON only, exactly in this shape:
{"questions":[{"level":"easy","topic":"short topic name","title":"short title, at most 8 words","prompt":"the full question","solution":"the model answer"}]}`;
}

async function askGemini(prompt: string) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("The GEMINI_API_KEY secret is not set.");
  const models = [...new Set([Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest", "gemini-flash-lite-latest"])];
  let last = "";
  // Each model gets 2 tries; a busy model (503/429) is retried after a short pause.
  const attempts = models.flatMap((m) => [m, m]);
  for (let i = 0; i < attempts.length; i++) {
    const model = attempts[i];
    if (i > 0 && attempts[i - 1] === model) await new Promise((r) => setTimeout(r, 8000));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45000);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        signal: ctl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.9 },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        last = `${model}: ${data?.error?.message || res.status}`;
        if (![429, 500, 503].includes(res.status) && attempts[i + 1] === model) i++; // don't retry a hard error on the same model
        continue;
      }
      const text = (data?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("");
      return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch (e) {
      last = `${model}: ${(e as Error).name === "AbortError" ? "timed out" : (e as Error).message}`;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(last || "No Gemini model answered.");
}

// Forces Gemini to answer in exactly this JSON shape.
const SCHEMA = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          level: { type: "STRING", enum: ["easy", "medium", "hard"] },
          topic: { type: "STRING" },
          title: { type: "STRING" },
          prompt: { type: "STRING" },
          solution: { type: "STRING" },
        },
        required: ["level", "topic", "title", "prompt", "solution"],
      },
    },
  },
  required: ["questions"],
};

type Q = { level: string; topic: string; title: string; prompt: string; solution: string };

// Find the list of questions whatever shape the AI used: a bare list, {"questions": [...]},
// another key name, or lists grouped by level like {"easy": [...], "medium": [...]}.
function findList(out: unknown): Record<string, unknown>[] {
  if (Array.isArray(out)) return out as Record<string, unknown>[];
  if (!out || typeof out !== "object") return [];
  const o = out as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (k.toLowerCase() === "questions" && Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
  }
  const byLevel: Record<string, unknown>[] = [];
  for (const k of Object.keys(o)) {
    const lv = k.toLowerCase();
    if (["easy", "medium", "hard"].includes(lv) && Array.isArray(o[k])) {
      (o[k] as Record<string, unknown>[]).forEach((q) => byLevel.push({ level: lv, ...q }));
    }
  }
  if (byLevel.length) return byLevel;
  for (const k of Object.keys(o)) {
    if (Array.isArray(o[k]) && (o[k] as unknown[]).some((x) => x && typeof x === "object")) return o[k] as Record<string, unknown>[];
    if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) { const inner = findList(o[k]); if (inner.length) return inner; }
  }
  return [];
}

function clean(out: unknown): Q[] {
  const pick = (q: Record<string, unknown>, ...keys: string[]) => {
    for (const k of keys) { const v = q[k] ?? q[k.charAt(0).toUpperCase() + k.slice(1)]; if (v != null && v !== "") return String(v); }
    return "";
  };
  const arr = findList(out).map((q) => ({
    level: pick(q, "level", "difficulty"),
    topic: pick(q, "topic", "category"),
    title: pick(q, "title", "name"),
    prompt: pick(q, "prompt", "question", "text", "problem", "description"),
    solution: pick(q, "solution", "answer", "model_answer", "modelAnswer", "explanation"),
  }));
  if (!arr.length) throw new Error("The AI reply had no questions list. Reply started: " + JSON.stringify(out).slice(0, 160));
  const order = ["easy", "medium", "hard"];
  const qs = arr
    .map((q) => ({
      level: q.level.toLowerCase().trim(),
      topic: q.topic.trim().slice(0, 60),
      title: (q.title || q.prompt.split("\n")[0]).trim().slice(0, 120),
      prompt: q.prompt.trim().slice(0, 4000),
      solution: q.solution.trim().slice(0, 6000),
    }))
    .filter((q) => order.includes(q.level) && q.title && q.prompt && q.solution);
  qs.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  if (!qs.length) throw new Error("The AI reply had no usable questions.");
  return qs.slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const day = istDay();

  try {
    const { data: set, error: readErr } = await db.from("daily_sets").select("*").eq("day", day).maybeSingle();
    if (readErr) throw new Error("Database read failed: " + readErr.message);
    if (set?.status === "ready") return json({ day, status: "ready" });

    const stale = set?.status === "generating" && Date.now() - new Date(set.started_at).getTime() > 4 * 60e3;
    if (set?.status === "generating" && !stale) return json({ day, status: "generating" });

    // Claim the job so only one caller generates.
    if (!set) {
      const { error } = await db.from("daily_sets").insert({ day, status: "generating" });
      if (error && error.code === "23505") return json({ day, status: "generating" }); // someone else just started it
      if (error) throw new Error("Database write failed: " + error.message);
    } else {
      const { data: claimed } = await db.from("daily_sets")
        .update({ status: "generating", started_at: new Date().toISOString(), error: null })
        .eq("day", day).eq("status", set.status).select("day");
      if (!claimed?.length) return json({ day, status: "generating" });
    }

    // Only make subjects that don't have questions yet (a retry fills the gaps).
    const { data: have } = await db.from("questions").select("subject").eq("day", day);
    const done = new Set((have || []).map((q) => q.subject));
    const todo = SUBJECTS.filter((s) => !done.has(s.name));

    const { data: recentRows } = await db.from("questions").select("subject,title")
      .gte("day", istDay(-21)).lt("day", day);

    const results = await Promise.allSettled(todo.map(async (s) => {
      const base = SUBJECTS.indexOf(s) * 100;
      const recent = (recentRows || []).filter((r) => r.subject === s.name).map((r) => r.title).slice(-60);
      const qs = clean(await askGemini(buildPrompt(s, recent)));
      const { data: rows, error } = await db.from("questions").insert(qs.map((q, i) => ({
        day, subject: s.name, level: q.level, topic: q.topic || null, title: q.title, prompt: q.prompt, position: base + i,
      }))).select("id,position");
      if (error) throw new Error(error.message);
      const { error: e2 } = await db.from("solutions").insert(
        (rows || []).map((r) => ({ question_id: r.id, solution: qs[r.position - base].solution })),
      );
      if (e2) throw new Error(e2.message);
    }));

    const failed = results
      .map((r, i) => (r.status === "rejected" ? `${todo[i].name}: ${(r.reason as Error)?.message || r.reason}` : null))
      .filter(Boolean) as string[];
    const madeOrHad = done.size + todo.length - failed.length;
    const status = failed.length === 0 ? "ready" : madeOrHad > 0 ? "partial" : "failed";
    await db.from("daily_sets").update({ status, error: failed.join(" | ") || null }).eq("day", day);
    return json({ day, status, error: failed.join(" | ") || undefined });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    await db.from("daily_sets").update({ status: "failed", error: msg }).eq("day", day);
    return json({ day, status: "failed", error: msg }, 500);
  }
});
