# Mock Coding Interview

Voice mock coding interviews in the browser. Real company questions, Python that runs and is tested in the page, and a Claude Opus interviewer you talk to out loud.

## What it does

* **A spoken interview.** Jordan, the interviewer, talks through your speakers and listens through your microphone the whole time. Ask clarifying questions, explain your approach and think out loud. Talking over him interrupts him, like a real call.
* **Real questions.** 3,422 questions with company frequency data (682 companies, filters for the last 30 days, 3 months, 6 months or all time). 2,591 of them are playable, each rewritten as a full prompt with examples, constraints, hidden tests and a large input for timing.
* **Python runs in your browser** through Pyodide, and SQL questions run on SQLite. Run checks the examples; Submit adds the hidden tests and a large input timed against a reference solution.
* **Formats.** One problem in 45 minutes, two problems in 45 minutes, or a quick 20 minute round. Pick up to five topics, a company or company group, difficulty and how recently it was asked.
* **Approach first.** The editor unlocks once you share your approach and its time and space complexity.
* **Notepad** on ruled paper, with a pencil, pens, highlighter and eraser for sketching.
* **Scorecard** for technical skill, correctness, code quality, complexity, speed and communication, with the optimal solution, the transcript and your history.

## Use it

Open the GitHub Pages site in Chrome, Edge or Safari (Firefox can't turn speech into text).

1. Paste an Anthropic API key from [console.anthropic.com](https://console.anthropic.com/settings/keys) on the start page and click **Save and test**. The default model is Claude Opus 5.5.
2. Allow the microphone when the browser asks.
3. Click **Join interview**. Headphones help, so the mic doesn't pick up Jordan's voice.

Your API key, history and settings stay in your browser's local storage. The key is only ever sent to `api.anthropic.com`, and API usage is billed to your Anthropic account.

## Run it locally

Any static file server works, for example:

```
python3 -m http.server 8000
```

then open http://localhost:8000. Opening `index.html` straight from disk won't work, because the page loads its data files with `fetch`.

## Credits

Question lists and company frequencies come from [snehasishroy/leetcode-companywise-interview-questions](https://github.com/snehasishroy/leetcode-companywise-interview-questions) and [liquidslr/leetcode-company-wise-problems](https://github.com/liquidslr/leetcode-company-wise-problems). Problem statements, examples, hints and solutions here are written fresh; each question links to the original on LeetCode for more practice.
