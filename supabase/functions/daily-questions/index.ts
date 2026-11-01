// Supabase Edge Function: daily-questions (deployed in this project as "rapid-api")
// Makes ONE set of practice questions per day (India time), shared by every Daybook user,
// using Google's Gemini API. Each subject gets one small dataset and 7 questions on it,
// plus a "checker" (reference formula / query / code) the app runs to auto-check answers.
//
// Deploy: Supabase → Edge Functions → your function → Code → paste this file → Deploy.
// Secrets: GEMINI_API_KEY (required), GEMINI_MODEL (optional model ID from Google AI Studio).

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const LEVELS: Record<string, number> = { easy: 2, medium: 3, hard: 2 };

type Subject = { name: string; topics: string; rules: string; data: boolean };
const SUBJECTS: Subject[] = [
  {
    name: "Excel",
    data: true,
    topics: "SUM/AVERAGE/ROUND, IF / IFS / AND / OR, SUMIFS / COUNTIFS / AVERAGEIFS, VLOOKUP / INDEX-MATCH / XLOOKUP, text functions (LEFT, MID, PROPER, CONCAT, TRIM), date functions (YEAR, MONTH, DATEDIF), MAX/MIN with criteria, percentage calculations",
    rules: `DATASET: exactly one table named "Sheet1". Its header row is row 1 of the sheet starting in column A, data starts in row 2. 10 to 15 data rows, 4 to 7 columns. Dates as text YYYY-MM-DD.
EVERY QUESTION: the answer is ONE formula typed in ONE cell that returns ONE value. Set "answer_cell" to that cell (an empty cell to the right of the data, e.g. "H2"), and say in the prompt: "In cell H2, write a formula that ...". For row-level tasks ask about a specific row (e.g. "for the employee in row 5").
"checker": the correct formula, starting with "=", using only cell references and standard functions. Do NOT use dynamic-array functions (FILTER, UNIQUE, SORT, SEQUENCE), LET or LAMBDA.`,
  },
  {
    name: "SQL",
    data: true,
    topics: "filtering and sorting, aggregations and GROUP BY / HAVING, joins, subqueries, CTEs, window functions (ROW_NUMBER, RANK, DENSE_RANK, LAG/LEAD, running totals), CASE WHEN, date functions, de-duplication",
    rules: `DATASET: 1 to 3 related tables with snake_case names and columns, 8 to 15 rows each. Dates as text YYYY-MM-DD.
EVERY QUESTION: answered by one SELECT query on these tables. Do not repeat the table data in the prompt (the app shows the tables).
"checker": a correct query in SQLite syntax (use strftime('%Y', col) / strftime('%m', col) for dates, || for text concat, no ILIKE). Add ORDER BY only if the question asks for an order. Set "answer_cell" to "".`,
  },
  {
    name: "Python",
    data: true,
    topics: "Pandas filtering, groupby and aggregation, merge, pivot_table, sorting / nlargest, apply and lambda, datetime with pd.to_datetime, string methods (.str), handling nulls and duplicates, value_counts",
    rules: `DATASET: 1 or 2 tables. Each table is already loaded as a pandas DataFrame whose variable name is the table name (snake_case, e.g. orders). 10 to 15 rows. Dates as text YYYY-MM-DD.
EVERY QUESTION: say in the prompt "Store your answer in a variable named result." The answer is a number, text, list, Series or DataFrame. Do not repeat the table data in the prompt.
"checker": correct pandas code (pd is imported) that assigns the answer to result. No printing, plotting or file reading. Set "answer_cell" to "".`,
  },
  {
    name: "Power BI",
    data: true,
    topics: "DAX measures (SUM, DIVIDE, COUNTROWS, DISTINCTCOUNT), CALCULATE and filter context, ALL / ALLEXCEPT, time intelligence (YTD, MoM, same period last year), RELATED and relationships, calculated columns vs measures, percent of total, ranking with RANKX",
    rules: `DATASET: 1 to 3 related tables (a fact table and dimension tables) with clear names, 8 to 15 rows each. Dates as text YYYY-MM-DD.
EVERY QUESTION: ask the learner to write a DAX measure and then report ONE number it returns for a stated filter (e.g. "What does the measure return for Region = North?").
"checker": a SQLite query on the same tables that returns that one number (one row, one column). "solution": the DAX measure plus the number and explanation. Set "answer_cell" to "".`,
  },
  {
    name: "Business case",
    data: false,
    topics: "KPIs and metric definitions, root cause analysis of a metric drop, guesstimates, A/B testing, funnel and cohort analysis, retention, pricing, e-commerce / quick-commerce / fintech / food delivery scenarios in India",
    rules: `No dataset: return "datasets": []. Give a concrete scenario with numbers where useful. Answers are structured approaches. Set "checker" and "answer_cell" to "".`,
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

function buildPrompt(s: Subject, recent: string[]) {
  const total = LEVELS.easy + LEVELS.medium + LEVELS.hard;
  return `You write daily hands-on practice questions for aspiring data analysts in India.
Subject: ${s.name}
${s.data ? "First create ONE realistic small business dataset (Indian context: cities, ₹ amounts, Indian names). Then write" : "Write"} exactly ${LEVELS.easy} easy, ${LEVELS.medium} medium and ${LEVELS.hard} hard questions (${total} total) in that order${s.data ? ", all answerable from that dataset" : ""}.
Spread them across different topics from: ${s.topics}.
Easy = one concept. Medium = combines 2 or 3 concepts. Hard = multi-step, realistic interview level.
${s.rules}
Every cell value in the dataset rows is a string (numbers as plain digits like "1250" or "12.5", no ₹ sign or commas inside numbers).
For every question write "solution": the correct answer (formula, query, code, DAX or approach) followed by a 1 to 3 sentence explanation. Put code in triple-backtick blocks. Keep each prompt under 120 words.
${recent.length ? `Do NOT repeat or closely paraphrase any of these recent questions:\n- ${recent.join("\n- ")}\n` : ""}
Respond with JSON only in this shape:
{"datasets":[{"name":"table_name","columns":["col1","col2"],"rows":[["v1","v2"]]}],"questions":[{"level":"easy","topic":"short topic","title":"short title, at most 8 words","prompt":"the question","answer_cell":"","checker":"","solution":"the model answer"}]}`;
}

// Forces Gemini to answer in exactly this JSON shape.
const SCHEMA = {
  type: "OBJECT",
  properties: {
    datasets: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          columns: { type: "ARRAY", items: { type: "STRING" } },
          rows: { type: "ARRAY", items: { type: "ARRAY", items: { type: "STRING" } } },
        },
        required: ["name", "columns", "rows"],
      },
    },
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          level: { type: "STRING", enum: ["easy", "medium", "hard"] },
          topic: { type: "STRING" },
          title: { type: "STRING" },
          prompt: { type: "STRING" },
          answer_cell: { type: "STRING" },
          checker: { type: "STRING" },
          solution: { type: "STRING" },
        },
        required: ["level", "topic", "title", "prompt", "answer_cell", "checker", "solution"],
      },
    },
  },
  required: ["datasets", "questions"],
};

async function askGemini(prompt: string, deadline: number) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("The GEMINI_API_KEY secret is not set.");
  const models = [...new Set([Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest", "gemini-flash-lite-latest"])];
  let last = "";
  // Each model gets 2 tries; a busy model (503/429) is retried after a short pause.
  const attempts = models.flatMap((m) => [m, m]);
  for (let i = 0; i < attempts.length; i++) {
    const model = attempts[i];
    const left = deadline - Date.now();
    if (left < 20000) break; // not enough time left for another call
    if (i > 0 && attempts[i - 1] === model) await new Promise((r) => setTimeout(r, 6000));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.min(90000, deadline - Date.now()));
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        signal: ctl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.8 },
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
  throw new Error(last || "No Gemini model answered in time.");
}

type Table = { name: string; columns: string[]; rows: string[][] };
type Q = { level: string; topic: string; title: string; prompt: string; answer_cell: string; checker: string; solution: string };

// Find the list of questions whatever shape the AI used.
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
  return byLevel;
}

function cleanTables(out: unknown): Table[] {
  const raw = (out as { datasets?: unknown })?.datasets;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 3).map((t) => {
    const o = (t || {}) as Record<string, unknown>;
    const name = String(o.name || "data").trim().replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "t_$1").slice(0, 40) || "data";
    const columns = (Array.isArray(o.columns) ? o.columns : []).slice(0, 10).map((c) => String(c ?? "").trim().slice(0, 40));
    const rows = (Array.isArray(o.rows) ? o.rows : []).slice(0, 25)
      .filter(Array.isArray)
      .map((r) => columns.map((_, i) => String((r as unknown[])[i] ?? "").trim().slice(0, 80)));
    return { name, columns, rows };
  }).filter((t) => t.columns.length && t.rows.length);
}

function cleanQuestions(out: unknown): Q[] {
  const pick = (q: Record<string, unknown>, ...keys: string[]) => {
    for (const k of keys) { const v = q[k] ?? q[k.charAt(0).toUpperCase() + k.slice(1)]; if (v != null && v !== "") return String(v); }
    return "";
  };
  const arr = findList(out).map((q) => ({
    level: pick(q, "level", "difficulty").toLowerCase().trim(),
    topic: pick(q, "topic", "category").trim().slice(0, 60),
    title: pick(q, "title", "name").trim().slice(0, 120),
    prompt: pick(q, "prompt", "question", "text").trim().slice(0, 4000),
    answer_cell: pick(q, "answer_cell", "answerCell").trim().toUpperCase(),
    checker: pick(q, "checker", "check").trim().replace(/^```[a-z]*\s*|\s*```$/gi, "").slice(0, 3000),
    solution: pick(q, "solution", "answer", "model_answer").trim().slice(0, 6000),
  }));
  if (!arr.length) throw new Error("The AI reply had no questions list. Reply started: " + JSON.stringify(out).slice(0, 160));
  const order = ["easy", "medium", "hard"];
  const qs = arr
    .map((q) => ({ ...q, title: q.title || q.prompt.split("\n")[0].slice(0, 120), answer_cell: /^[A-Z]{1,2}[1-9][0-9]{0,2}$/.test(q.answer_cell) ? q.answer_cell : "" }))
    .filter((q) => order.includes(q.level) && q.prompt && q.solution);
  qs.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  if (!qs.length) throw new Error("The AI reply had no usable questions.");
  return qs.slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const started = Date.now();
  const deadline = started + 135000; // stay inside the free plan's 150 s limit

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
      const out = await askGemini(buildPrompt(s, recent), deadline);
      const tables = s.data ? cleanTables(out) : [];
      if (s.data && !tables.length) throw new Error("The AI reply had no dataset.");
      const qs = cleanQuestions(out);
      const { data: rows, error } = await db.from("questions").insert(qs.map((q, i) => ({
        day, subject: s.name, level: q.level, topic: q.topic || null, title: q.title, prompt: q.prompt, position: base + i,
        data: tables.length ? tables : null,
        answer_cell: q.answer_cell || null,
        checker: s.data && q.checker ? q.checker : null,
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
